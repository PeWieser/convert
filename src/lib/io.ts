/** Storage errors must never enter the damaged-media salvage path. */
export class OutputWriteError extends Error {
  constructor(cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? "");
    super(`Die Ausgabe konnte nicht sicher gespeichert werden. Prüfe Zielordner, Verbindung und freien Speicher. Die Quelldatei wurde nicht verändert.${detail ? ` (${detail})` : ""}`);
    this.name = "OutputWriteError";
  }
}

/** Keep the native transaction open until finish; a failed encode only aborts it. */
export function transactionalStream(stream: FileSystemWritableFileStream) {
  const writer = stream.getWriter();
  const writable = new WritableStream({
    async write(chunk) {
      try { await writer.write(chunk); } catch (e) { throw new OutputWriteError(e); }
    },
    // Mediabunny closes its target before the caller commits the file.
    close() {},
    async abort() { await writer.abort().catch(() => undefined); },
  });
  return {
    writable,
    async commit() {
      try { await writer.close(); } catch (e) { throw new OutputWriteError(e); }
    },
    async abort() { await writer.abort().catch(() => undefined); },
  };
}
