import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  createPPDetection,
  PPDetectionError,
  type PPDetectionDetector
} from "web-sdk-pp-detection";

const manifestUrl =
  "https://www.modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/master/manifest.json?v=1.0.1";

export function App(): ReactElement {
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("请选择图片，默认从 ModelScope 加载官方 PicoDet 模型");
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      // 即使初始化迟到，detect 的 finally 也会 dispose 该实例。
    };
  }, []);

  const detect = async (): Promise<void> => {
    if (!file || controller.current) return;
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true);
    setOutput("");
    let detector: PPDetectionDetector | undefined;
    const current = () => mounted.current && !operation.signal.aborted;
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
          setStatus(`${event.phase}: ${event.status}`);
          if (event.totalBytes) setProgress(((event.loadedBytes ?? 0) / event.totalBytes) * 100);
        }
      });
      if (!current()) return;
      const result = await detector.detect(file, { threshold: 0.5, signal: operation.signal });
      if (!current()) return;
      setOutput(JSON.stringify(result, null, 2));
      setStatus(`检测完成：${result.detections.length} 个目标`);
      setProgress(100);
    } catch (error) {
      if (current())
        setOutput(
          JSON.stringify(
            error instanceof PPDetectionError
              ? { code: error.code, message: error.message, details: error.details }
              : { message: String(error) },
            null,
            2
          )
        );
    } finally {
      try {
        await detector?.dispose();
      } finally {
        controller.current = undefined;
        if (mounted.current) {
          setBusy(false);
          if (operation.signal.aborted) setStatus("已取消并释放模型");
        }
      }
    }
  };

  return (
    <main>
      <h1>React 示例</h1>
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0])}
      />
      <button disabled={busy || !file} onClick={() => void detect()}>
        检测
      </button>
      <button disabled={!busy} onClick={() => controller.current?.abort()}>
        取消
      </button>
      <p>{status}</p>
      <progress max="100" value={progress} />
      <pre>{output}</pre>
    </main>
  );
}
