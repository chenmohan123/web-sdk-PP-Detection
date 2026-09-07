import {
  createPPDetection,
  PPDetectionError,
  type PPDetectionDetector
} from "web-sdk-pp-detection";

const manifestUrl =
  "https://www.modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/master/manifest.json?v=1.0.1";
const image = document.querySelector<HTMLInputElement>("#image")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const progress = document.querySelector<HTMLProgressElement>("#progress")!;
const output = document.querySelector<HTMLPreElement>("#output")!;
const button = document.querySelector<HTMLButtonElement>("#detect")!;
const cancel = document.createElement("button");
cancel.textContent = "取消";
cancel.disabled = true;
button.after(cancel);
let controller: AbortController | undefined;
let mounted = true;
cancel.addEventListener("click", () => controller?.abort());
window.addEventListener("pagehide", () => {
  mounted = false;
  controller?.abort();
});
window.addEventListener("pageshow", () => {
  mounted = true;
});

button.addEventListener("click", async () => {
  const file = image.files?.[0];
  if (!file || controller) return;
  const operation = new AbortController();
  controller = operation;
  button.disabled = image.disabled = true;
  cancel.disabled = false;
  output.textContent = "";
  let detector: PPDetectionDetector | undefined;
  const current = () => mounted && !operation.signal.aborted;
  try {
    detector = await createPPDetection({
      model: manifestUrl,
      source: "modelscope",
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
    progress.value = 100;
    status.textContent = `检测完成：${result.detections.length} 个目标`;
    output.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    if (current())
      output.textContent = JSON.stringify(
        error instanceof PPDetectionError
          ? { code: error.code, message: error.message, details: error.details }
          : { message: String(error) },
        null,
        2
      );
  } finally {
    // 未能中止的初始化也必须等待完成后释放迟到实例。
    try {
      await detector?.dispose();
    } finally {
      controller = undefined;
      button.disabled = image.disabled = false;
      cancel.disabled = true;
      if (mounted && operation.signal.aborted) status.textContent = "已取消并释放模型";
    }
  }
});

document.addEventListener("WeixinJSBridgeReady", () => {
  if (!controller) status.textContent = "微信 H5/WebView 已就绪；不支持微信小程序原生推理";
});
