import {
  Check,
  Camera,
  ChevronDown,
  CircleAlert,
  Download,
  FileImage,
  Github,
  Film,
  Square,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  CURRENT_SDK_VERSION,
  clearModelCache,
  createPPDetection,
  parseModelManifest,
  type PPDetectionDetector,
  type PPDetectionResult,
  type PPDetectionLoadTimings,
  type ModelManifest
} from "web-sdk-pp-detection";

import {
  allowFallbackForSelection,
  precisionForBackend,
  supportsCombination,
  type BackendPreference,
  type PrecisionPreference
} from "./execution-preferences";
import {
  classThresholdValue,
  DEFAULT_CLASS_LABELS,
  selectActiveClassThresholds,
  setClassThresholdValue,
  uniqueLabels
} from "./class-thresholds";
import { tinyModelData, tinyModelManifest } from "./fixture";
import { demoSamples, fetchSampleFile, sampleUrl, type DemoSample } from "./samples";
import { en } from "./i18n/en";
import { zhCN, type Copy } from "./i18n/zh-CN";
import { modelProgressState } from "./model-progress";
import {
  DEFAULT_MODEL_SOURCE,
  MODEL_SOURCE_OPTIONS,
  selectionToModel,
  type ModelSourceKey
} from "./model-sources";
import { formatFallbackCause, formatRuntimeError } from "./runtime-messages";
import { VideoFrameScheduler } from "./media-frame-scheduler";

type Language = "zh" | "en";
type Overlay = "box" | "polygon";
type InputMode = "image" | "camera" | "video";
type Status = "ready" | "downloading" | "loading" | "running" | "success" | "error";

type DemoLoadTimings = PPDetectionLoadTimings & {
  readonly integrityMs?: number;
  readonly modelCacheReadMs?: number;
  readonly modelDownloadMs?: number;
  readonly modelSource?: "cache" | "custom" | "memory" | "network";
};

const demoFixture = new URLSearchParams(window.location.search).has("fixture");
const fixtureOrtWasmBaseUrl = new URL("/ort-fixture/", window.location.href).href;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "-" : `${Math.round(value)} ms`;
}

function drawResult(
  canvas: HTMLCanvasElement,
  source: HTMLImageElement | HTMLVideoElement | null | undefined,
  result: PPDetectionResult | undefined,
  overlay: Overlay
): void {
  if (source == null || result === undefined) return;
  const width =
    source instanceof HTMLVideoElement
      ? source.videoWidth || result.image.original.width
      : source.naturalWidth || result.image.original.width;
  const height =
    source instanceof HTMLVideoElement
      ? source.videoHeight || result.image.original.height
      : source.naturalHeight || result.image.original.height;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  context.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 180));
  context.strokeStyle = "#e4572e";
  context.fillStyle = "rgba(228, 87, 46, 0.12)";
  for (const detection of result.detections) {
    const points = detection.polygon;
    context.beginPath();
    if (overlay === "polygon" && points.length > 1) {
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.closePath();
    } else {
      context.rect(
        detection.box.xMin,
        detection.box.yMin,
        detection.box.xMax - detection.box.xMin,
        detection.box.yMax - detection.box.yMin
      );
    }
    context.fill();
    context.stroke();
  }
}

function drawSource(canvas: HTMLCanvasElement, source: HTMLImageElement): void {
  const width = source.naturalWidth;
  const height = source.naturalHeight;
  if (width <= 0 || height <= 0) return;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(source, 0, 0, width, height);
}

function drawVideoSource(canvas: HTMLCanvasElement, source: HTMLVideoElement): void {
  const width = source.videoWidth;
  const height = source.videoHeight;
  if (width <= 0 || height <= 0) return;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(source, 0, 0, width, height);
}

export function App(): ReactElement {
  const [language, setLanguage] = useState<Language>("zh");
  const copy: Copy = language === "zh" ? zhCN : en;
  const [backend, setBackend] = useState<BackendPreference>("auto");
  const [precision, setPrecision] = useState<PrecisionPreference>("auto");
  const [modelSource, setModelSource] = useState<ModelSourceKey>(DEFAULT_MODEL_SOURCE);
  const [modelSourceChanging, setModelSourceChanging] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("box");
  const [inputMode, setInputMode] = useState<InputMode>("image");
  const [threshold, setThreshold] = useState(0.5);
  const [status, setStatus] = useState<Status>("ready");
  const [downloadPercentage, setDownloadPercentage] = useState<number | undefined>();
  const [file, setFile] = useState<File | undefined>();
  const [videoFile, setVideoFile] = useState<File | undefined>();
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [cameraActive, setCameraActive] = useState(false);
  const [result, setResult] = useState<PPDetectionResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState<string | undefined>();
  const [customManifest, setCustomManifest] = useState<ModelManifest | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [selectedSample, setSelectedSample] = useState<DemoSample | undefined>();
  const [classThresholds, setClassThresholds] = useState<Record<string, number>>({});
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<PPDetectionDetector | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const schedulerRef = useRef<VideoFrameScheduler | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const loadTimings: DemoLoadTimings | undefined = detectorRef.current?.loadTimings;
  const activeModelSource =
    MODEL_SOURCE_OPTIONS.find((option) => option.key === modelSource) ?? MODEL_SOURCE_OPTIONS[0];
  const activeLabels = uniqueLabels(
    customManifest?.labels ?? (demoFixture ? tinyModelManifest.labels : DEFAULT_CLASS_LABELS)
  );
  const activeClassThresholds = selectActiveClassThresholds(activeLabels, classThresholds);

  const activeMediaLabel =
    inputMode === "image"
      ? (file?.name ?? copy.noImage)
      : inputMode === "camera"
        ? cameraActive
          ? copy.cameraActive
          : copy.cameraIdle
        : (videoFile?.name ?? copy.noVideo);

  const redraw = useCallback(() => {
    const source = inputMode === "image" ? imageRef.current : videoRef.current;
    drawResult(canvasRef.current!, source, result, overlay);
  }, [inputMode, overlay, result]);

  useEffect(() => redraw(), [redraw]);
  useEffect(
    () => () => {
      if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl);
      if (videoUrl !== undefined) URL.revokeObjectURL(videoUrl);
      schedulerRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void detectorRef.current?.dispose();
    },
    [imageUrl, videoUrl]
  );

  useEffect(() => {
    if (!cameraActive || inputMode !== "camera") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video === null || stream === undefined) return;
    video.srcObject = stream;
    let cancelled = false;
    void video
      .play()
      .then(() => {
        if (cancelled) return;
        schedulerRef.current?.stop();
        schedulerRef.current = new VideoFrameScheduler(video, (timestampMs) => {
          return runDetection(video, timestampMs);
        });
        schedulerRef.current.start();
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        stopCamera();
        setError(formatRuntimeError(caught));
        setStatus("error");
      });
    return () => {
      cancelled = true;
      schedulerRef.current?.stop();
      schedulerRef.current = undefined;
    };
  }, [cameraActive, inputMode]);

  const onImage = (next: File | undefined): void => {
    if (next === undefined) return;
    stopVideo();
    if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl);
    if (videoUrl !== undefined) URL.revokeObjectURL(videoUrl);
    setFile(next);
    setVideoFile(undefined);
    setVideoUrl(undefined);
    setImageUrl(URL.createObjectURL(next));
    setResult(undefined);
    setError(undefined);
    setNotice(undefined);
    setStatus("ready");
    setSelectedSample(undefined);
  };

  const onVideo = (next: File | undefined): void => {
    if (next === undefined) return;
    stopCamera();
    if (videoUrl !== undefined) URL.revokeObjectURL(videoUrl);
    if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl);
    setVideoFile(next);
    setVideoUrl(URL.createObjectURL(next));
    setFile(undefined);
    setImageUrl(undefined);
    setResult(undefined);
    setError(undefined);
    setNotice(undefined);
    setStatus("ready");
    setInputMode("video");
    setSelectedSample(undefined);
  };

  function stopCamera(): void {
    abortRef.current?.abort("media-stopped");
    abortRef.current = undefined;
    schedulerRef.current?.stop();
    schedulerRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  const startCamera = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(copy.cameraUnsupported);
      setStatus("error");
      return;
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      setInputMode("camera");
      setFile(undefined);
      if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl);
      setImageUrl(undefined);
      setVideoFile(undefined);
      if (videoUrl !== undefined) URL.revokeObjectURL(videoUrl);
      setVideoUrl(undefined);
      setResult(undefined);
      setError(undefined);
      setStatus("ready");
      setCameraActive(true);
    } catch (caught) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = undefined;
      setCameraActive(false);
      setError(formatRuntimeError(caught));
      setStatus("error");
    }
  };

  const onSample = async (sample: DemoSample): Promise<void> => {
    try {
      const next = await fetchSampleFile(sample);
      onImage(next);
      setSelectedSample(sample);
    } catch (caught) {
      setError(formatRuntimeError(caught));
      setStatus("error");
    }
  };

  const onBackend = (next: BackendPreference): void => {
    const nextPrecision = precisionForBackend(next, precision, customManifest);
    setBackend(next);
    if (nextPrecision !== precision) {
      setPrecision(nextPrecision);
      setNotice(next === "webgpu" ? copy.precisionAdjusted : copy.cpuFp16Unsupported);
    }
  };

  const onModelSource = async (next: ModelSourceKey): Promise<void> => {
    if (inputMode !== "image") stopVideo();
    cancel();
    setModelSourceChanging(true);
    const detector = detectorRef.current;
    detectorRef.current = undefined;
    try {
      await detector?.dispose();
    } catch (caught) {
      setError(formatRuntimeError(caught));
      setStatus("error");
      setModelSourceChanging(false);
      return;
    }
    setModelSource(next);
    setCustomManifest(undefined);
    setResult(undefined);
    setError(undefined);
    setNotice(undefined);
    setDownloadPercentage(undefined);
    setStatus("ready");
    if (imageRef.current !== null) drawSource(canvasRef.current!, imageRef.current);
    setModelSourceChanging(false);
  };

  const cancel = (): void => {
    abortRef.current?.abort("cancelled");
    abortRef.current = undefined;
    setStatus("ready");
  };

  const updateClassThreshold = (label: string, value: string): void => {
    setClassThresholds((current) => setClassThresholdValue(current, label, value));
  };

  const runDetection = async (
    source: File | HTMLVideoElement = file!,
    timestampMs?: number
  ): Promise<void> => {
    if (source === undefined) return;
    if (inputMode === "camera" && detectorRef.current === undefined) {
      setError(undefined);
      setStatus("loading");
    } else if (inputMode !== "camera") {
      cancel();
      setError(undefined);
      setStatus("loading");
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setDownloadPercentage(undefined);
    try {
      if (inputMode !== "camera") {
        const previousDetector = detectorRef.current;
        detectorRef.current = undefined;
        await previousDetector?.dispose();
      }
      let detector = detectorRef.current;
      if (detector === undefined) {
        const model = demoFixture
          ? { data: tinyModelData(), manifest: tinyModelManifest }
          : (customManifest ?? selectionToModel(modelSource));
        detector = await createPPDetection({
          allowFallback: allowFallbackForSelection(backend, precision),
          backend,
          cache: true,
          ...(model === undefined ? {} : { model }),
          onProgress: (event) => {
            const nextProgress = modelProgressState(event);
            if (nextProgress === undefined) return;
            setStatus(nextProgress.status);
            setDownloadPercentage(
              nextProgress.status === "downloading" ? nextProgress.percentage : undefined
            );
          },
          ...(demoFixture ? { ort: { wasm: { paths: fixtureOrtWasmBaseUrl } } } : {}),
          precision,
          ...(demoFixture
            ? {}
            : { source: modelSource === "default" ? "huggingface" : modelSource }),
          signal: controller.signal
        });
        detectorRef.current = detector;
      }
      setStatus("running");
      const nextResult = await detector.detect(source, {
        ...(Object.keys(activeClassThresholds).length === 0
          ? {}
          : { classThresholds: activeClassThresholds }),
        signal: controller.signal,
        threshold,
        ...(timestampMs === undefined ? {} : { timestampMs })
      });
      setResult(nextResult);
      setStatus(inputMode === "image" ? "success" : "running");
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (inputMode !== "image") {
        schedulerRef.current?.stop();
        schedulerRef.current = undefined;
      }
      setError(formatRuntimeError(caught));
      setStatus("error");
    }
  };

  const startVideo = async (): Promise<void> => {
    const video = videoRef.current;
    if (video === null || videoUrl === undefined) return;
    stopCamera();
    setInputMode("video");
    setResult(undefined);
    setError(undefined);
    try {
      const previousDetector = detectorRef.current;
      detectorRef.current = undefined;
      await previousDetector?.dispose();
      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          video.addEventListener("loadeddata", () => resolve(), { once: true });
        });
      }
      await video.play();
      schedulerRef.current = new VideoFrameScheduler(video, (timestampMs) => {
        return runDetection(video, timestampMs);
      });
      schedulerRef.current.start();
    } catch (caught) {
      setError(formatRuntimeError(caught));
      setStatus("error");
    }
  };

  const stopVideo = (): void => {
    abortRef.current?.abort("media-stopped");
    abortRef.current = undefined;
    schedulerRef.current?.stop();
    schedulerRef.current = undefined;
    videoRef.current?.pause();
    if (inputMode === "camera") stopCamera();
    setStatus("ready");
  };

  const exportJson = (): void => {
    if (result === undefined) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "pp-detection-result.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const validateCustom = (): void => {
    try {
      const parsed = parseModelManifest(JSON.parse(customText) as unknown);
      setCustomManifest(parsed);
      setCustomError(undefined);
    } catch {
      setCustomManifest(undefined);
      setCustomError(copy.invalidManifest);
    }
  };

  const clearCache = async (): Promise<void> => {
    await clearModelCache();
    setNotice(copy.cacheCleared);
  };

  return (
    <main className="demo-shell" data-testid="demo-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="eyebrow">ONNX RUNTIME WEB</span>
          <h1>PP-Detection</h1>
          <span className="version">SDK {CURRENT_SDK_VERSION}</span>
        </div>
        <div className="top-actions">
          <a
            className="text-button repository-link"
            href="https://github.com/chenmohan123/web-sdk-PP-Detection"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={16} />
            GitHub
          </a>
          <button
            className="language-button"
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
          >
            {copy.language}
          </button>
          <button className="text-button" onClick={() => setCustomOpen(true)}>
            <Upload size={16} />
            {copy.custom}
          </button>
        </div>
      </header>

      <section className="control-band" data-testid="controls">
        <label className="control-group">
          <span className="control-label">{copy.modelRepository}</span>
          <select
            aria-describedby="model-source-limitations"
            aria-label={copy.modelRepository}
            disabled={
              modelSourceChanging ||
              status === "downloading" ||
              status === "loading" ||
              status === "running"
            }
            value={modelSource}
            onChange={(event) => void onModelSource(event.target.value as ModelSourceKey)}
          >
            {MODEL_SOURCE_OPTIONS.map((option) => (
              <option
                disabled={!option.available}
                key={option.key}
                title={option.disabledReason?.[language]}
                value={option.key}
              >
                {option.label[language]}
                {option.available ? "" : ` (${copy.unavailable})`}
              </option>
            ))}
          </select>
          <small
            className="model-source-limitations"
            data-testid="model-source-limitations"
            id="model-source-limitations"
          >
            {MODEL_SOURCE_OPTIONS.filter((option) => !option.available)
              .map(
                (option) =>
                  `${option.label[language]}: ${option.disabledReason?.[language] ?? copy.unavailable}`
              )
              .join(" ")}
          </small>
        </label>
        <div className="control-group" role="group" aria-label={copy.backend}>
          <span className="control-label">{copy.backend}</span>
          <div className="segmented">
            {(["auto", "webgpu", "wasm"] as const).map((value) => (
              <button
                key={value}
                className={backend === value ? "selected" : ""}
                aria-pressed={backend === value}
                disabled={inputMode !== "image" && status === "running"}
                onClick={() => onBackend(value)}
              >
                {copy[value]}
              </button>
            ))}
          </div>
        </div>
        <div className="control-group" role="group" aria-label={copy.precision}>
          <span className="control-label">{copy.precision}</span>
          <div className="segmented">
            {(["auto", "fp16", "fp32"] as const).map((value) => {
              const unsupported =
                backend !== "auto" &&
                value !== "auto" &&
                !supportsCombination(backend, value, customManifest);
              return (
                <button
                  key={value}
                  className={precision === value ? "selected" : ""}
                  aria-pressed={precision === value}
                  disabled={unsupported || (inputMode !== "image" && status === "running")}
                  title={
                    unsupported
                      ? backend === "webgpu"
                        ? copy.precisionAdjusted
                        : copy.cpuFp16Unsupported
                      : undefined
                  }
                  onClick={() => setPrecision(value)}
                >
                  {copy[value]}
                </button>
              );
            })}
          </div>
        </div>
        <label className="threshold-control">
          <span>{copy.threshold}</span>
          <input
            aria-label={copy.threshold}
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />
          <output>{threshold.toFixed(2)}</output>
        </label>
        <div className="control-group" role="group" aria-label={copy.inputMode}>
          <span className="control-label">{copy.inputMode}</span>
          <div className="segmented">
            <button
              className={inputMode === "image" ? "selected" : ""}
              aria-pressed={inputMode === "image"}
              onClick={() => {
                stopVideo();
                setInputMode("image");
              }}
            >
              <FileImage size={14} />
              {copy.imageInput}
            </button>
            <button
              className={inputMode === "camera" ? "selected" : ""}
              aria-pressed={inputMode === "camera"}
              onClick={() => void startCamera()}
            >
              <Camera size={14} />
              {copy.cameraInput}
            </button>
            <button
              className={inputMode === "video" ? "selected" : ""}
              aria-pressed={inputMode === "video"}
              onClick={() => {
                stopVideo();
                setInputMode("video");
              }}
            >
              <Film size={14} />
              {copy.videoInput}
            </button>
          </div>
        </div>
        <div className="control-actions">
          {inputMode === "image" ? (
            <>
              <label className="file-button">
                <FileImage size={17} />
                <span>{file === undefined ? copy.selectImage : copy.replaceImage}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => onImage(event.target.files?.[0])}
                />
              </label>
              <button
                className="primary-button"
                disabled={
                  file === undefined ||
                  modelSourceChanging ||
                  status === "downloading" ||
                  status === "loading" ||
                  status === "running"
                }
                onClick={() => void runDetection()}
              >
                <Check size={17} />
                {copy.start}
              </button>
            </>
          ) : inputMode === "video" ? (
            <>
              <label className="file-button">
                <Film size={17} />
                <span>{videoFile === undefined ? copy.noVideo : videoFile.name}</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/ogg"
                  onChange={(event) => onVideo(event.target.files?.[0])}
                />
              </label>
              <button
                className="primary-button"
                disabled={videoUrl === undefined || status === "running" || modelSourceChanging}
                onClick={() => void startVideo()}
              >
                <Check size={17} />
                {copy.startVideo}
              </button>
            </>
          ) : (
            <button
              className="primary-button"
              disabled={cameraActive || modelSourceChanging || status === "running"}
              onClick={() => void startCamera()}
            >
              <Camera size={17} />
              {copy.startCamera}
            </button>
          )}
          <button className="secondary-button" onClick={inputMode === "image" ? cancel : stopVideo}>
            {inputMode === "image" ? <X size={17} /> : <Square size={16} />}
            {inputMode === "image" ? copy.cancel : copy.stopMedia}
          </button>
        </div>
      </section>

      <details className="class-threshold-editor" data-testid="class-threshold-editor">
        <summary>
          <span>{copy.classThresholds}</span>
          <small>{copy.classThresholdHint}</small>
        </summary>
        <div className="class-threshold-toolbar">
          <span className="muted">{copy.classThresholdHint}</span>
          <button
            className="text-button"
            aria-label={copy.clearClassThresholds}
            onClick={() => setClassThresholds({})}
            type="button"
          >
            <Trash2 size={15} />
            {copy.clearClassThresholds}
          </button>
        </div>
        <div className="class-threshold-grid">
          {activeLabels.map((label) => (
            <label className="class-threshold-field" key={label}>
              <span>{label}</span>
              <input
                aria-label={`${copy.classThreshold} ${label}`}
                max="1"
                min="0"
                onChange={(event) => updateClassThreshold(label, event.target.value)}
                placeholder={threshold.toFixed(2)}
                step="0.05"
                type="number"
                value={classThresholdValue(classThresholds, label)}
              />
            </label>
          ))}
        </div>
      </details>

      <div className="status-line" data-testid="status">
        <span className={`status-dot ${status}`} />
        {status === "downloading"
          ? `${copy.downloading}${downloadPercentage === undefined ? "" : ` ${downloadPercentage}%`}`
          : status === "loading"
            ? copy.loading
            : status === "running"
              ? copy.running
              : status === "success"
                ? copy.success
                : status === "error"
                  ? copy.error
                  : copy.ready}
        <span className="status-hint">{activeMediaLabel}</span>
      </div>
      {error !== undefined && (
        <div className="error-banner" role="alert">
          <CircleAlert size={18} />
          {error}
        </div>
      )}
      {notice !== undefined && (
        <div className="notice-banner" role="status" data-testid="notice">
          <Check size={17} />
          {notice}
        </div>
      )}

      <section className="workspace-grid">
        <article className="result-panel" data-testid="result-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DOCUMENT VIEW</span>
              <h2>{copy.result}</h2>
            </div>
            <div className="overlay-toggle">
              <button
                className={overlay === "box" ? "selected" : ""}
                onClick={() => setOverlay("box")}
                aria-pressed={overlay === "box"}
              >
                {copy.box}
              </button>
              <button
                className={overlay === "polygon" ? "selected" : ""}
                onClick={() => setOverlay("polygon")}
                aria-pressed={overlay === "polygon"}
              >
                {copy.polygon}
              </button>
            </div>
          </div>
          <div className={`canvas-wrap ${inputMode === "image" ? "" : "media-canvas-wrap"}`}>
            {inputMode === "image" && imageUrl === undefined ? (
              <div className="empty-state">
                <FileImage size={30} />
                <span>{copy.noImage}</span>
                <small>{copy.selectHint}</small>
              </div>
            ) : inputMode === "image" ? (
              <img
                ref={imageRef}
                src={imageUrl}
                alt=""
                className="source-image"
                onLoad={(event) => {
                  imageRef.current = event.currentTarget;
                  drawSource(canvasRef.current!, event.currentTarget);
                  redraw();
                }}
              />
            ) : (
              <>
                {(cameraActive || videoUrl !== undefined) && (
                  <video
                    ref={videoRef}
                    className="source-video"
                    src={videoUrl}
                    muted
                    playsInline
                    onEnded={stopVideo}
                    onLoadedMetadata={(event) =>
                      drawVideoSource(canvasRef.current!, event.currentTarget)
                    }
                  />
                )}
                {!cameraActive && videoUrl === undefined && (
                  <div className="empty-state">
                    <Film size={30} />
                    <span>{copy.noVideo}</span>
                    <small>{copy.videoHint}</small>
                  </div>
                )}
              </>
            )}
            <canvas
              ref={canvasRef}
              data-testid="result-canvas"
              className={
                (
                  inputMode === "image"
                    ? imageUrl === undefined
                    : videoUrl === undefined && !cameraActive
                )
                  ? "hidden"
                  : "result-canvas"
              }
            />
          </div>
          <section
            className="sample-gallery"
            data-testid="sample-gallery"
            aria-label={copy.samples}
          >
            <div className="sample-gallery-heading">
              <span className="control-label">{copy.samples}</span>
              <span className="sample-source" data-testid="sample-source">
                {selectedSample === undefined
                  ? copy.sampleSource
                  : `${copy.sampleSource}: PaddleOCR`}
              </span>
            </div>
            <div className="sample-grid">
              {demoSamples.map((sample) => (
                <button
                  className="sample-card"
                  key={sample.id}
                  onClick={() => void onSample(sample)}
                >
                  <img src={sampleUrl(sample)} alt={sample.label[language]} />
                  <span>{sample.label[language]}</span>
                  <small>{sample.coverage[language]}</small>
                </button>
              ))}
            </div>
            {selectedSample !== undefined && (
              <a
                className="sample-attribution"
                href={selectedSample.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {copy.sampleSource}: PaddleOCR
              </a>
            )}
          </section>
        </article>

        <aside className="details-panel" data-testid="details-panel">
          <section
            className="detail-section"
            data-testid="performance-section"
            data-sdk-timing="true"
          >
            <div className="section-title">
              <h2>{copy.performance}</h2>
              <ChevronDown size={17} />
            </div>
            <div className="timing-group" data-testid="initialization-timings">
              <h3 className="timing-group-title">{copy.initializationGroup}</h3>
              <dl className="metric-list">
                <div className="timing-total-row">
                  <dt>{copy.loadTotal}</dt>
                  <dd>{formatMs(loadTimings?.totalMs)}</dd>
                </div>
                <div>
                  <dt>{copy.modelDownload}</dt>
                  <dd>{formatMs(loadTimings?.modelDownloadMs)}</dd>
                </div>
                <div>
                  <dt>{copy.modelCache}</dt>
                  <dd>{formatMs(loadTimings?.modelCacheReadMs)}</dd>
                </div>
                <div>
                  <dt>{copy.integrity}</dt>
                  <dd>{formatMs(loadTimings?.integrityMs)}</dd>
                </div>
                <div>
                  <dt>{copy.modelSource}</dt>
                  <dd>
                    {loadTimings?.modelSource === undefined
                      ? "-"
                      : copy[`source_${loadTimings.modelSource}`]}
                  </dd>
                </div>
                <div>
                  <dt>{copy.session}</dt>
                  <dd>{formatMs(loadTimings?.sessionMs)}</dd>
                </div>
              </dl>
            </div>
            <div className="timing-group" data-testid="detection-timings">
              <h3 className="timing-group-title">{copy.detectionGroup}</h3>
              <dl className="metric-list">
                <div className="timing-total-row">
                  <dt>{copy.total}</dt>
                  <dd data-testid="timing-total">{formatMs(result?.timings.totalMs)}</dd>
                </div>
                <div>
                  <dt>{copy.decode}</dt>
                  <dd>{formatMs(result?.timings.decodeMs)}</dd>
                </div>
                <div>
                  <dt>{copy.preprocess}</dt>
                  <dd>{formatMs(result?.timings.preprocessMs)}</dd>
                </div>
                <div>
                  <dt>{copy.inference}</dt>
                  <dd>{formatMs(result?.timings.inferenceMs)}</dd>
                </div>
                <div>
                  <dt>{copy.postprocess}</dt>
                  <dd>{formatMs(result?.timings.postprocessMs)}</dd>
                </div>
              </dl>
              <p className="timing-note">{copy.timingOverhead}</p>
            </div>
          </section>
          <section
            className="detail-section"
            data-testid="model-section"
            data-sdk-model-info="true"
            data-sdk-runtime-info="true"
          >
            <div className="section-title">
              <h2>{copy.modelInfo}</h2>
              <ChevronDown size={17} />
            </div>
            <dl className="metric-list model-list">
              <div>
                <dt>{copy.modelRepository}</dt>
                <dd data-testid="model-source-value">
                  {customManifest === undefined
                    ? activeModelSource.label[language]
                    : copy.source_custom}
                </dd>
              </div>
              <div>
                <dt>{copy.manifest}</dt>
                <dd className="model-source-manifest" data-testid="model-source-manifest">
                  {customManifest === undefined
                    ? (activeModelSource.manifestUrl ?? copy.sdkDefaultManifest)
                    : copy.source_custom}
                </dd>
              </div>
              <div>
                <dt>{copy.modelName}</dt>
                <dd data-testid="model-name">{result?.model.id ?? "-"}</dd>
              </div>
              <div>
                <dt>{copy.requestedSource}</dt>
                <dd>
                  {customManifest === undefined
                    ? activeModelSource.label[language]
                    : copy.source_custom}
                </dd>
              </div>
              <div>
                <dt>{copy.actualSource}</dt>
                <dd data-testid="model-actual-source">{result?.model.source.kind ?? "-"}</dd>
              </div>
              <div>
                <dt>{copy.revision}</dt>
                <dd className="model-source-hash" data-testid="model-revision">
                  {result?.model.source.revision ?? "-"}
                </dd>
              </div>
              <div>
                <dt>{copy.checksum}</dt>
                <dd className="model-source-hash" data-testid="model-sha256">
                  {result?.model.source.sha256 ?? "-"}
                </dd>
              </div>
              <div>
                <dt>{copy.modelSize}</dt>
                <dd>{result ? formatBytes(result.model.bytes) : "-"}</dd>
              </div>
              <div>
                <dt>{copy.parameters}</dt>
                <dd>
                  {result?.model.parameterCount === null
                    ? copy.unknown
                    : result
                      ? result.model.parameterCount.toLocaleString()
                      : "-"}
                </dd>
              </div>
              <div>
                <dt>{copy.backendInfo}</dt>
                <dd>{result?.runtime.backend ?? "-"}</dd>
              </div>
              <div>
                <dt>{copy.precisionInfo}</dt>
                <dd>{result?.runtime.precision ?? "-"}</dd>
              </div>
              <div>
                <dt>{copy.mode}</dt>
                <dd>{result?.runtime.mode ?? "-"}</dd>
              </div>
            </dl>
            {result === undefined && activeModelSource.disabledReason !== undefined ? (
              <p className="model-source-blocked" data-testid="model-source-blocked">
                {activeModelSource.disabledReason[language]}
              </p>
            ) : null}
          </section>
          <div data-testid="fallback-slot">
            {result?.runtime.fallbacks.length ? (
              <section className="detail-section" data-testid="fallback-section">
                <div className="section-title">
                  <h2>{copy.fallback}</h2>
                  <span className="count-badge">{result.runtime.fallbacks.length}</span>
                </div>
                {result.runtime.fallbacks.map((fallback, index) => (
                  <div className="fallback-row" key={`${fallback.variantId}-${index}`}>
                    <strong>
                      {fallback.provider} · {fallback.precision}
                    </strong>
                    <small>
                      {fallback.code} · {fallback.stage}
                    </small>
                    <small>{formatFallbackCause(fallback)}</small>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
          <section className="detail-section detection-section" data-testid="detection-section">
            <div className="section-title">
              <h2>{copy.result}</h2>
              <span className="count-badge">
                {result?.detections.length ?? 0} {copy.detections}
              </span>
            </div>
            {result?.detections.length ? (
              result.detections.map((detection, index) => (
                <div className="detection-row" key={`${detection.labelId}-${index}`}>
                  <span className="detection-index">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{detection.label}</strong>
                    <small>
                      {(detection.score * 100).toFixed(1)}% · {detection.box.xMin.toFixed(0)},
                      {detection.box.yMin.toFixed(0)}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">{copy.noDetections}</p>
            )}
          </section>
          <div className="detail-actions" data-testid="detail-actions">
            <button className="text-button" disabled={result === undefined} onClick={exportJson}>
              <Download size={16} />
              {copy.exportJson}
            </button>
            <button className="text-button" onClick={() => void clearCache()}>
              <Trash2 size={16} />
              {copy.clearCache}
            </button>
          </div>
        </aside>
      </section>

      {customOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label={copy.customTitle}>
            <div className="modal-heading">
              <h2>{copy.customTitle}</h2>
              <button
                className="icon-button"
                onClick={() => setCustomOpen(false)}
                title={copy.close}
              >
                <X size={17} />
              </button>
            </div>
            <p>{copy.customHint}</p>
            <textarea
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              aria-label="manifest JSON"
              placeholder="{ ... }"
            />
            {customError !== undefined && (
              <div className="error-banner" role="alert">
                {customError}
              </div>
            )}
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setCustomOpen(false)}>
                {copy.close}
              </button>
              <button className="primary-button" onClick={validateCustom}>
                {copy.validate}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
