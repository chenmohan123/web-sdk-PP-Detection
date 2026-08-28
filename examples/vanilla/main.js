import {
  createPPDetection,
  PPDetectionError
} from "https://unpkg.com/web-sdk-pp-detection@0.1.0/dist/index.js";

const manifestUrl = "https://models.example.com/pp-detection/manifest.json";
const imageInput = document.querySelector("#image");
const detectButton = document.querySelector("#detect");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
let detector;

detectButton.addEventListener("click", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  detectButton.disabled = true;
  try {
    await detector?.dispose();
    detector = await createPPDetection({
      model: manifestUrl,
      backend: "auto",
      precision: "auto",
      onProgress: (event) => {
        status.textContent = `${event.phase}: ${event.status}`;
      }
    });
    const output = await detector.detect(file, { threshold: 0.5 });
    status.textContent = `完成，${output.detections.length} 个检测结果`;
    result.textContent = JSON.stringify(
      {
        model: output.model,
        runtime: output.runtime,
        timings: output.timings,
        detections: output.detections
      },
      null,
      2
    );
  } catch (error) {
    const detail =
      error instanceof PPDetectionError
        ? { code: error.code, message: error.message, details: error.details }
        : { message: String(error) };
    status.textContent = "检测失败";
    result.textContent = JSON.stringify(detail, null, 2);
  } finally {
    detectButton.disabled = false;
  }
});

window.addEventListener("pagehide", () => void detector?.dispose());
