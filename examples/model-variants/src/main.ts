import {
  createPPDetection,
  PPDetectionError,
  type Detection,
  type ModelSourceKind,
  type PPDetectionDetector,
  type Precision
} from "web-sdk-pp-detection";

type ModelId = "picodet" | "ppyoloe";
type SourceId = Extract<ModelSourceKind, "modelscope" | "huggingface">;
type PrecisionId = "fp32" | "fp16" | "w8a32";

const defaultSelection = { model: "picodet", source: "modelscope", precision: "fp32" } as const;
const manifestPaths: Record<ModelId, string> = {
  picodet: "picodet-l-320/1.0.2/manifest.json",
  ppyoloe: "ppyoloe-plus-s-640/0.1.1/manifest.json"
};
const manifestRoots: Record<SourceId, string> = {
  modelscope:
    "https://modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/88d23d254e9cc2c98874ae8bd8a7c092612e65f6",
  huggingface:
    "https://huggingface.co/chenmohan/web-sdk-pp-detection/resolve/16e7920650777479820b9301dec90a59b0d5833c"
};
const precisionOptions: Record<PrecisionId, Precision> = {
  fp32: "fp32",
  fp16: "fp16",
  w8a32: "int8"
};

const model = document.querySelector<HTMLSelectElement>("#model")!;
const source = document.querySelector<HTMLSelectElement>("#source")!;
const precision = document.querySelector<HTMLSelectElement>("#precision")!;
const image = document.querySelector<HTMLInputElement>("#image")!;
const detectButton = document.querySelector<HTMLButtonElement>("#detect")!;
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const progress = document.querySelector<HTMLProgressElement>("#progress")!;
const preview = document.querySelector<HTMLCanvasElement>("#preview")!;
const output = document.querySelector<HTMLPreElement>("#output")!;

model.value = defaultSelection.model;
source.value = defaultSelection.source;
precision.value = defaultSelection.precision;

let controller: AbortController | undefined;
let mounted = true;

function selected<T extends string>(element: HTMLSelectElement): T {
  return element.value as T;
}

function setBusy(busy: boolean): void {
  for (const control of [model, source, precision, image, detectButton]) control.disabled = busy;
  cancelButton.disabled = !busy;
}

async function drawResult(file: File, detections: readonly Detection[]): Promise<void> {
  const bitmap = await createImageBitmap(file);
  try {
    preview.width = bitmap.width;
    preview.height = bitmap.height;
    preview.hidden = false;
    const context = preview.getContext("2d");
    if (!context) throw new Error("浏览器无法创建 2D 画布");
    context.drawImage(bitmap, 0, 0);
    context.lineWidth = Math.max(2, Math.round(Math.min(bitmap.width, bitmap.height) / 240));
    context.font = `${Math.max(14, Math.round(bitmap.width / 50))}px system-ui`;
    for (const detection of detections) {
      const { x, y, width, height } = detection.box;
      const label = `${detection.label} ${(detection.score * 100).toFixed(1)}%`;
      context.strokeStyle = "#00d084";
      context.fillStyle = "#00d084";
      context.strokeRect(x, y, width, height);
      const textWidth = context.measureText(label).width + 10;
      const textHeight = Math.max(20, Math.round(bitmap.width / 40));
      context.fillRect(x, Math.max(0, y - textHeight), textWidth, textHeight);
      context.fillStyle = "#07140f";
      context.fillText(label, x + 5, Math.max(15, y - 5));
    }
  } finally {
    bitmap.close();
  }
}

cancelButton.addEventListener("click", () => controller?.abort());
window.addEventListener("pagehide", () => {
  mounted = false;
  controller?.abort();
});
window.addEventListener("pageshow", () => {
  mounted = true;
});

detectButton.addEventListener("click", async () => {
  const file = image.files?.[0];
  if (!file || controller) return;
  const operation = new AbortController();
  controller = operation;
  setBusy(true);
  progress.value = 0;
  output.textContent = "";
  preview.hidden = true;
  let detector: PPDetectionDetector | undefined;
  const current = () => mounted && !operation.signal.aborted;
  const sourceKind = selected<SourceId>(source);
  const precisionId = selected<PrecisionId>(precision);
  const manifestUrl = `${manifestRoots[sourceKind]}/${manifestPaths[selected<ModelId>(model)]}`;

  try {
    detector = await createPPDetection({
      model: manifestUrl,
      source: sourceKind,
      precision: precisionOptions[precisionId],
      backend: "auto",
      allowFallback: true,
      executionMode: "main",
      signal: operation.signal,
      onProgress: (event) => {
        if (!current()) return;
        status.textContent = `${event.phase}: ${event.status}`;
        if (event.totalBytes) progress.value = ((event.loadedBytes ?? 0) / event.totalBytes) * 100;
      }
    });
    if (!current()) return;
    const result = await detector.detect(file, { threshold: 0.5, signal: operation.signal });
    if (!current()) return;
    await drawResult(file, result.detections);
    if (!current()) return;
    progress.value = 100;
    status.textContent = `检测完成：${result.detections.length} 个目标`;
    output.textContent = JSON.stringify(
      {
        manifestUrl,
        model: result.model,
        runtime: result.runtime,
        timings: result.timings,
        detections: result.detections
      },
      null,
      2
    );
  } catch (error) {
    if (current()) {
      const detail =
        error instanceof PPDetectionError
          ? { code: error.code, message: error.message, details: error.details }
          : { message: String(error) };
      status.textContent = "检测失败";
      output.textContent = JSON.stringify(detail, null, 2);
    }
  } finally {
    try {
      await detector?.dispose();
    } finally {
      controller = undefined;
      if (mounted) {
        setBusy(false);
        if (operation.signal.aborted) status.textContent = "已取消并释放模型";
      }
    }
  }
});
