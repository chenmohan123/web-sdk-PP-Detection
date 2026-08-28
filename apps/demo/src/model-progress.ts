import type { PPDetectionProgressEvent } from "web-sdk-pp-detection";

export type ModelProgressState =
  { readonly status: "downloading"; readonly percentage?: number } | { readonly status: "loading" };

export function modelProgressState(
  event: PPDetectionProgressEvent
): ModelProgressState | undefined {
  if (event.phase === "session") return { status: "loading" };
  if (event.phase !== "model") return undefined;
  if (event.loadedBytes === undefined) return { status: "loading" };
  if (event.totalBytes === undefined || event.totalBytes <= 0) {
    return { status: "downloading" };
  }
  return {
    percentage: Math.min(100, Math.round((event.loadedBytes / event.totalBytes) * 100)),
    status: "downloading"
  };
}
