import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { NativeStore } from "./fs-node";
import { FfmpegEngine } from "./engine-ffmpeg";
import { conversionSchema, id, settingsSchema } from "./validation";
import { run } from "./process";
import type { Target } from "../src/lib/platform";

protocol.registerSchemesAsPrivileged([{ scheme: "wandler-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const store = new NativeStore();
let win: BrowserWindow;
let closing = false;
let progress = -1;
const renderer = pathToFileURL(path.join(__dirname, "renderer", "index.html")).href;
const engine = new FfmpegEngine(store, { install: process.resourcesPath, userData: app.getPath("userData"), home: app.getPath("home") }, (id, fraction, seconds) => {
  if (!win.isDestroyed()) win.webContents.send("engine:progress", id, fraction, seconds);
});
const trusted = (e: IpcMainEvent | IpcMainInvokeEvent) => !!win && e.sender === win.webContents && e.senderFrame === win.webContents.mainFrame && e.senderFrame?.url === renderer;
const destinationFile = () => path.join(app.getPath("userData"), "destination.json");

// Each handler returns an explicit result: Electron's serialized Error loses error types.
function handle(channel: string, fn: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) throw new Error("Nicht erlaubter Absender.");
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error), canceled: error instanceof DOMException && error.name === "AbortError" }; }
  });
}
function attachHandlers() {
  handle("engine:init", () => engine.init());
  handle("engine:hardware", () => engine.hardware());
  handle("files:pick", async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"] });
    return r.canceled ? [] : store.add(r.filePaths, "Konvertiert");
  });
  handle("files:folder", async (skip) => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled ? [] : store.add(r.filePaths, z.string().max(120).parse(skip));
  });
  handle("files:drop", (paths, skip) => store.add(z.array(z.string().max(32768)).max(10000).parse(paths), z.string().max(120).parse(skip)));
  handle("folders:choose", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Zielordner wählen", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled) return null;
    store.custom = await fs.realpath(r.filePaths[0]);
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    await fs.writeFile(destinationFile(), JSON.stringify(store.custom));
    return path.basename(store.custom);
  });
  handle("folders:forget", async () => { store.custom = null; await fs.unlink(destinationFile()).catch(() => undefined); });
  handle("output:plan", (ids, settings) => store.plan(z.array(id).max(10000).parse(ids), settingsSchema.parse(settings)));
  handle("output:open", (target, sourceId, ext, settings) => store.open(target as Target, id.parse(sourceId), z.string().max(8).parse(ext), settingsSchema.parse(settings)));
  handle("output:finish", (outputId) => {
    const parsed = id.parse(outputId);
    if (engine.active.has(parsed)) throw new Error("Die Ausgabe wird noch geschrieben.");
    return store.finish(parsed);
  });
  handle("output:discard", (outputId) => {
    const parsed = id.parse(outputId);
    if (engine.active.has(parsed)) throw new Error("Bitte zuerst den laufenden Auftrag stoppen.");
    return store.discard(parsed);
  });
  handle("engine:probe", (sourceId) => engine.probe(id.parse(sourceId)));
  handle("engine:convert", (req) => engine.convert(conversionSchema.parse(req)));
  ipcMain.on("engine:cancel", (e, outputId) => { if (trusted(e) && typeof outputId === "string") engine.cancel(outputId); });
  ipcMain.on("window:progress", (e, value) => {
    if (!trusted(e) || typeof value !== "number" || !Number.isFinite(value)) return;
    progress = Math.max(-1, Math.min(1, value));
    win.setProgressBar(progress);
  });
  ipcMain.on("window:action", (e, action) => {
    if (!trusted(e)) return;
    if (action === "minimize") win.minimize();
    if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === "close") win.close();
  });
}

async function ensureTools() {
  try { await engine.tools(); return; } catch { /* explain and offer setup */ }
  if (process.platform !== "win32") return;
  const answer = await dialog.showMessageBox(win, { type: "question", title: "FFmpeg fehlt", message: "FFmpeg und FFprobe werden zum Konvertieren benötigt.", detail: "Jetzt den geprüften GPL-Build von BtbN herunterladen? Eine Internetverbindung ist erforderlich. FFmpeg ist nicht im App-Installer enthalten.", buttons: ["Herunterladen", "Später"], defaultId: 0, cancelId: 1 });
  if (answer.response !== 0) return;
  win.setProgressBar(2); // indeterminate
  try {
    const script = path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, ".."), "setup-ffmpeg.ps1");
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], { timeout: 600000 });
    win.webContents.reload();
  } catch (e) {
    await dialog.showMessageBox(win, { type: "error", message: "FFmpeg konnte nicht eingerichtet werden.", detail: String(e), buttons: ["OK"] });
  } finally { win.setProgressBar(-1); }
}

app.whenReady().then(async () => {
  try { const dir = JSON.parse(await fs.readFile(destinationFile(), "utf8")); if (typeof dir === "string") store.custom = dir; } catch { /* first launch */ }
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: {
    ...details.responseHeaders,
    "Content-Security-Policy": ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: wandler-media:; connect-src 'self' wandler-media:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'"],
  } }));
  protocol.handle("wandler-media", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "source" || request.method !== "GET") return new Response(null, { status: 403 });
      const src = store.getSource(id.parse(url.pathname.slice(1)));
      return await net.fetch(pathToFileURL(src.path).href, { headers: request.headers });
    } catch { return new Response(null, { status: 404 }); }
  });
  win = new BrowserWindow({ icon: path.join(__dirname, "wandler.png"), width: 1024, height: 760, minWidth: 740, minHeight: 540, frame: false, transparent: true, backgroundColor: "#00000000", show: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
  win.webContents.on("render-process-gone", () => { for (const ac of engine.active.values()) ac.abort(); });
  attachHandlers();
  win.once("ready-to-show", () => { win.show(); void ensureTools(); });
  win.on("close", (e) => {
    if (closing || (engine.active.size === 0 && progress < 0)) return;
    e.preventDefault();
    void dialog.showMessageBox(win, { type: "question", message: "Konvertierung stoppen und Wandler schließen?", detail: "Fertige Dateien bleiben erhalten. Laufende Ausgaben werden verworfen.", buttons: ["Weiter konvertieren", "Stoppen und schließen"], defaultId: 0, cancelId: 0 }).then(async ({ response }) => {
      if (response !== 1) return;
      closing = true;
      await engine.stopAll();
      // Process close events have released file handles before cleanup.
      await Promise.allSettled([...store.outputs.keys()].map(async (outputId) => {
        if (!engine.active.has(outputId)) await store.discard(outputId);
      }));
      win.destroy();
      app.quit();
    });
  });
  await win.loadURL(renderer);
});
app.on("window-all-closed", () => app.quit());
