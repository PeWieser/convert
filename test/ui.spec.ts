import { expect, test } from "@playwright/test";

test("success and remove share a center and never overlap, including keyboard focus and locked rows", async ({ page }) => {
  await page.goto("/test/ui.html");
  const success = page.getByLabel("Fertig", { exact: true });
  const remove = page.getByRole("button", { name: "Film.mp4 entfernen" });
  const [checkBox, removeBox] = await page.locator("li").evaluate((el) => [el.querySelector(".file-success"), el.querySelector(".file-remove")].map((node) => node!.getBoundingClientRect().toJSON()));
  expect(checkBox).toEqual(removeBox);
  await remove.hover();
  await expect(success).toBeHidden();
  await expect(remove).toHaveCSS("opacity", "1");
  await page.mouse.move(5, 5);
  await remove.focus();
  await expect(success).toBeHidden();
  await expect(remove).toHaveCSS("opacity", "1");
  await page.getByText("Sperre umschalten").click();
  await page.locator("li").hover();
  await expect(success).toBeVisible();
  await expect(remove).toHaveCount(0);
});

test("three-dot menu does not press-scale or select its parent", async ({ page }) => {
  await page.goto("/test/ui.html");
  const card = page.getByRole("radio").nth(1);
  const button = card.getByRole("button");
  await button.hover();
  const before = await card.boundingBox();
  await page.mouse.down();
  await page.waitForTimeout(200);
  expect((await card.boundingBox())?.width).toBe(before?.width);
  expect(await card.evaluate((el) => getComputedStyle(el).scale)).toBe("none");
  await page.mouse.up();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(card).toHaveAttribute("aria-checked", "false");
});

test("drag keeps pointer origin and settles without reorder snap", async ({ page }) => {
  await page.goto("/test/ui.html");
  const first = page.getByRole("radio").first();
  const name = await first.getAttribute("aria-label");
  const start = (await first.boundingBox())!;
  const x = start.x + start.width / 2, y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y);
  await page.waitForTimeout(20);
  const armed = (await first.boundingBox())!;
  await page.mouse.move(x + 11, y);
  await page.waitForTimeout(20);
  const moved = (await first.boundingBox())!;
  expect(Math.abs((moved.x - armed.x) - 1)).toBeLessThan(2);
  await page.mouse.move(x + 520, y, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const beforeCommit = (await page.getByRole("radio", { name: name! }).boundingBox())!;
  await page.waitForTimeout(140);
  const afterCommit = (await page.getByRole("radio", { name: name! }).boundingBox())!;
  expect(Math.abs(afterCommit.x - beforeCommit.x)).toBeLessThan(3);
  await expect(page.getByRole("radio").last()).toHaveAttribute("aria-label", name!);
});

test("grid is always reachable and file collection locks immediately, including shortcuts", async ({ page }) => {
  await page.addInitScript(() => {
    const ok = (value: unknown) => Promise.resolve({ ok: true, value });
    Object.defineProperty(window, "wandler", { value: {
      init: () => ok({ video: ["h264"], audio: ["aac"], ready: true, subtitles: false, metadata: true, cover: false }),
      hardware: () => ok({ available: false, vendor: "none", gpu: "", encoder: "", source: "ffmpeg" }),
      pickFiles: () => new Promise(() => {}),
      progress: () => {},
    } });
  });
  await page.goto("/");
  const grid = page.getByRole("button", { name: /Alle Presets/ });
  await expect(grid).toBeVisible();
  await grid.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Fertig", exact: true }).click();
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("dialog", { name: "Dateien werden gelesen" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Dateien werden gelesen" })).toBeVisible();
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("dialog", { name: "Dateien werden gelesen" })).toHaveCount(1);
});

test("browser FSA: real stream commit, concurrent names and failed overwrite rollback", async ({ page }) => {
  await page.goto("/test/ui.html");
  const result = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(`test-${Date.now()}`, { create: true });
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => dir });
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: async () => [] });
    const fsaPath = "/src/lib/fsa.ts", storagePath = "/src/lib/storage.ts";
    const fsa = await import(/* @vite-ignore */ fsaPath);
    const { DEFAULT_SETTINGS } = await import(/* @vite-ignore */ storagePath);
    await fsa.chooseCustomDestination();
    const settings = { ...DEFAULT_SETTINGS, destination: "custom", collision: "number" };
    const a = { id: "a", file: new File(["source"], "Film.mp4"), name: "Film.mp4", relDirs: [] };
    const b = { ...a, id: "b" };
    const targets = await fsa.planTargets([a, b], settings);
    const [one, two] = await Promise.all([fsa.open(targets.get(a.id), a, "mp4", settings), fsa.open(targets.get(b.id), b, "mp4", settings)]);
    const write = async (out: { writable: WritableStream; finish: () => Promise<number> }, text: string) => {
      const w = out.writable.getWriter();
      await w.write({ type: "write", position: 0, data: new TextEncoder().encode(text) });
      await w.close();
      return out.finish();
    };
    await write(one, "GOOD A"); await write(two, "GOOD B");
    const overwrite = await fsa.open(targets.get(a.id), a, "mp4", { ...settings, collision: "overwrite" });
    const w = overwrite.writable.getWriter();
    await w.write({ type: "write", position: 0, data: new TextEncoder().encode("FAILED") });
    await w.close();
    await overwrite.discard();
    const first = await (await (await dir.getFileHandle("Film.mp4")).getFile()).text();
    const second = await (await (await dir.getFileHandle("Film 2.mp4")).getFile()).text();
    await root.removeEntry(dir.name, { recursive: true });
    return { first, second };
  });
  expect(result).toEqual({ first: "GOOD A", second: "GOOD B" });
});

test("metadata tab edits the file's own values and says what is written", async ({ page }) => {
  await page.goto("/test/ui.html");
  /* Der Inspektor ist ein Fenster über der Seite – er wird erst geöffnet. */
  await page.getByRole("button", { name: "Inspektor öffnen" }).click();
  const inspector = page.getByRole("dialog", { name: "Serie.S01E02.mkv bearbeiten" });
  /* Der Reiter steht links neben den Bildwerkzeugen. */
  await inspector.getByRole("button", { name: "Metadaten" }).click();

  /* Der vorhandene Titel steht im Formular – ein Bearbeiten, kein leeres Blatt. */
  const title = inspector.getByLabel("Titel", { exact: true });
  await expect(title).toHaveValue("Der Anfang");

  /* Ohne TMDB-Schlüssel erklärt das Fenster den Weg, statt leer zu bleiben. */
  await inspector.getByRole("button", { name: "Bei TMDB suchen" }).first().click();
  const tmdb = page.getByRole("dialog", { name: "Bei TMDB suchen" });
  await expect(tmdb).toBeVisible();
  await expect(tmdb.getByText(/Für die Suche fehlt der TMDB-Schlüssel/).first()).toBeVisible();
  await tmdb.getByRole("button", { name: "Abbrechen" }).click();
  await expect(tmdb).toBeHidden();

  /* Ein geänderter Wert trägt den Haken; ein Klick darauf stellt ihn zurück. */
  await title.fill("Der neue Titel");
  const revert = inspector.getByLabel("Titel zurücksetzen");
  await expect(revert).toBeVisible();
  await revert.click();
  await expect(title).toHaveValue("Der Anfang");

  /* Und was geschrieben wird, steht dabei: bei WebCodecs kein Titelbild. */
  await expect(inspector.getByText(/bettet nur die Desktop-App ein/).first()).toBeVisible();
});

test("a finished file has a way to the folder it was written to", async ({ page }) => {
  await page.goto("/test/ui.html");
  const reveal = page.getByRole("button", { name: "Zeigen" });
  await expect(reveal).toBeVisible();
  await reveal.click();
  /* Die Zeile kennt nur die Kennung – den Pfad löst die App auf. */
  await expect.poll(() => page.evaluate(() => (window as unknown as { __revealed?: string }).__revealed)).toBe("out-1");
});
