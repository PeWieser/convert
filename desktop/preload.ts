import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { NativeBridge } from "../src/lib/native-contract";

// Deliberately no generic invoke, filesystem API, shell command or raw path API.
const bridge: NativeBridge = {
  init: () => ipcRenderer.invoke("engine:init"),
  hardware: () => ipcRenderer.invoke("engine:hardware"),
  pickFiles: () => ipcRenderer.invoke("files:pick"),
  pickFolder: (skip) => ipcRenderer.invoke("files:folder", skip),
  drop: (files, skip) => ipcRenderer.invoke("files:drop", files.map((file) => webUtils.getPathForFile(file)).filter(Boolean), skip),
  chooseDestination: () => ipcRenderer.invoke("folders:choose"),
  forgetFolders: () => ipcRenderer.invoke("folders:forget"),
  plan: (ids, settings) => ipcRenderer.invoke("output:plan", ids, settings),
  open: (target, sourceId, ext, settings) => ipcRenderer.invoke("output:open", target, sourceId, ext, settings),
  finish: (id) => ipcRenderer.invoke("output:finish", id),
  discard: (id) => ipcRenderer.invoke("output:discard", id),
  probe: (id) => ipcRenderer.invoke("engine:probe", id),
  convert: (req) => ipcRenderer.invoke("engine:convert", req),
  cancel: (id) => ipcRenderer.send("engine:cancel", id),
  onProgress(listener) {
    const receive = (_event: Electron.IpcRendererEvent, id: string, fraction: number, seconds: number) => listener(id, fraction, seconds);
    ipcRenderer.on("engine:progress", receive);
    return () => ipcRenderer.removeListener("engine:progress", receive);
  },
  window: (action) => ipcRenderer.send("window:action", action),
  progress: (fraction) => ipcRenderer.send("window:progress", fraction),
};
contextBridge.exposeInMainWorld("wandler", bridge);
