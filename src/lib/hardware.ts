import type { HardwareInfo } from "./types";

/**
 * Liest den Namen der Grafikkarte aus WebGL – ein Hinweis, keine Wahrheit.
 * Firefox verdeckt den Namen ganz, Chrome schränkt ihn ein (Befund P2-10).
 * Ob wirklich beschleunigt wird, entscheidet `withEncoderTruth` aus dem, was der
 * Browser encodieren kann; auf dem Desktop entscheidet `hardwareFromEncoders`
 * aus der Liste von `ffmpeg -encoders`.
 */
export function detectHardware(): HardwareInfo {
  let renderer = "";
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    }
  } catch {
    /* ignorieren */
  }

  const raw = renderer.trim();
  const low = raw.toLowerCase();
  if (!raw) {
    /* Der Browser gibt nichts preis. „Prozessor" wäre geraten – also: unbekannt. */
    return { gpu: "Unbekannt", vendor: "none", encoder: "—", available: false, source: "webgl", hidden: true };
  }
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(low)) {
    return { gpu: "Prozessor", vendor: "none", encoder: "Software", available: false, source: "webgl" };
  }

  let name = raw.replace(/^ANGLE \(/, "").replace(/\)$/, "");
  const parts = name.split(", ");
  if (parts.length >= 2) name = parts[1];
  name = name
    .replace(/ANGLE Metal Renderer:\s*/i, "")
    .replace(/\(0x[0-9a-f]+\)/gi, "")
    .replace(/Direct3D\d*.*$/i, "")
    .replace(/OpenGL.*$/i, "")
    .replace(/vs_\d.*$/i, "")
    .replace(/\(R\)|\(TM\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/nvidia|geforce|rtx|gtx|quadro/.test(low)) return { gpu: name, vendor: "nvidia", encoder: "NVENC", available: true, source: "webgl" };
  if (/amd|radeon|\bati\b/.test(low)) return { gpu: name, vendor: "amd", encoder: "AMF", available: true, source: "webgl" };
  if (/intel|iris|uhd|\barc\b/.test(low)) return { gpu: name, vendor: "intel", encoder: "Quick Sync", available: true, source: "webgl" };
  if (/apple|\bm[1-9]\b/.test(low)) return { gpu: name, vendor: "apple", encoder: "VideoToolbox", available: true, source: "webgl" };
  return { gpu: name, vendor: "other", encoder: "GPU", available: true, source: "webgl" };
}

/**
 * Die Wahrheit des Desktops: die Encoder, die FFmpeg wirklich anbietet. Namen wie
 * `h264_nvenc`, `hevc_amf`, `h264_qsv` oder `h264_videotoolbox` sagen, welche
 * Technik im Rechner steckt – kein Treiber-String, kein Raten. Der Name der Karte
 * bleibt leer: FFmpeg nennt ihn nicht, und die App erfindet ihn nicht.
 */
export function hardwareFromEncoders(encoders: string[]): HardwareInfo {
  const list = encoders.map((e) => e.trim().toLowerCase());
  const has = (re: RegExp) => list.some((e) => re.test(e));
  if (has(/_nvenc$/)) return { gpu: "", vendor: "nvidia", encoder: "NVENC", available: true, source: "ffmpeg" };
  if (has(/_amf$/)) return { gpu: "", vendor: "amd", encoder: "AMF", available: true, source: "ffmpeg" };
  if (has(/_qsv$/)) return { gpu: "", vendor: "intel", encoder: "Quick Sync", available: true, source: "ffmpeg" };
  if (has(/videotoolbox$/)) return { gpu: "", vendor: "apple", encoder: "VideoToolbox", available: true, source: "ffmpeg" };
  return { gpu: "", vendor: "none", encoder: "Software", available: false, source: "ffmpeg" };
}

/**
 * Im Web: Eine gefundene Grafikkarte heißt noch nicht, dass beschleunigt wird.
 * Encodieren muss der Browser – kann er kein einziges Video-Format, gibt es
 * nichts zu beschleunigen, egal was im Treiber steht.
 */
export function withEncoderTruth(hw: HardwareInfo, encodableVideo: number): HardwareInfo {
  if (hw.source === "ffmpeg" || encodableVideo > 0) return hw;
  return { ...hw, available: false, encoder: hw.hidden ? "—" : "Software" };
}
