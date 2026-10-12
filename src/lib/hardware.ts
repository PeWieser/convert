import type { HardwareInfo } from "./types";

/**
 * Erkennt die Grafikkarte. Die App nutzt Hardware-Encoding immer automatisch,
 * sobald eine GPU vorhanden ist (NVENC, AMF, Quick Sync, VideoToolbox).
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
  if (!raw || /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(low)) {
    return { gpu: "Prozessor", vendor: "none", encoder: "Software", available: false };
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

  if (/nvidia|geforce|rtx|gtx|quadro/.test(low)) return { gpu: name, vendor: "nvidia", encoder: "NVENC", available: true };
  if (/amd|radeon|\bati\b/.test(low)) return { gpu: name, vendor: "amd", encoder: "AMF", available: true };
  if (/intel|iris|uhd|\barc\b/.test(low)) return { gpu: name, vendor: "intel", encoder: "Quick Sync", available: true };
  if (/apple|\bm[1-9]\b/.test(low)) return { gpu: name, vendor: "apple", encoder: "VideoToolbox", available: true };
  return { gpu: name, vendor: "other", encoder: "GPU", available: true };
}
