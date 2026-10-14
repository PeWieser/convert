import { spawn } from "node:child_process";

/** Bounded output, no shell, finite probe timeout, cancellable encoding. */
export function run(exe: string, args: string[], opts: { signal?: AbortSignal; timeout?: number; onLine?: (line: string) => void } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new DOMException("Abgebrochen", "AbortError")); return; }
    const child = spawn(exe, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", pending = "";
    let timedOut = false;
    const cancel = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", cancel, { once: true });
    const timer = opts.timeout ? setTimeout(() => { timedOut = true; cancel(); }, opts.timeout) : undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout = (stdout + text).slice(-4 * 1024 * 1024);
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop()!.slice(-65536);
      lines.forEach((line) => opts.onLine?.(line));
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-65536); });
    const cleanup = () => { clearTimeout(timer); opts.signal?.removeEventListener("abort", cancel); };
    child.on("error", (e) => { cleanup(); reject(e); });
    child.on("close", (code) => {
      cleanup();
      if (opts.signal?.aborted) reject(new DOMException("Abgebrochen", "AbortError"));
      else if (timedOut) reject(new Error("FFmpeg antwortet nicht (Zeitlimit)."));
      else if (code !== 0) reject(new Error(stderr.trim() || `Prozess beendet (${code}).`));
      else resolve({ stdout, stderr });
    });
  });
}
