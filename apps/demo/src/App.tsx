import {
  Check,
  Camera,
  ChevronDown,
  CircleAlert,
  Download,
  FileImage,
  Github,
  Film,
  RotateCcw,
  Square,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from "react";
import {
  CURRENT_SDK_VERSION,
  ModelManager,
  PPDetectionError,
  adaptModelManifest,
  createPPDetection,
  parseModelManifest,
  type PPDetectionDetector,
  type PPDetectionModel,
  type PPDetectionResult,
  type PPDetectionLoadTimings,
  type ModelManifest
} from "web-sdk-pp-detection";

import {
  allowFallbackForSelection,
  precisionForBackend,
  precisionLabel,
  type BackendPreference,
  type PrecisionPreference
} from "./execution-preferences";
import {
  classThresholdValue,
  selectActiveClassThresholds,
  setClassThresholdValue,
  uniqueLabels
} from "./class-thresholds";
import { tinyModelData, tinyModelManifest } from "./fixture";
import { demoSamples, fetchSampleFile, sampleUrl, type DemoSample } from "./samples";
import { en } from "./i18n/en";
import { detectionLabel } from "./i18n/detection-labels";
import { detectionColor, detectionFillColor } from "./detection-colors";
import { layoutDetectionLabels } from "./label-layout";
import { ClassFilter } from "./ClassFilter";
import { hitTestDetection } from "./detection-hit-test";
import { useImageViewport } from "./use-image-viewport";
import { zhCN, type Copy } from "./i18n/zh-CN";
import { modelProgressState } from "./model-progress";
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  defaultSource,
  modelOption,
  sourceOptions,
  type DemoModelKey,
  type ModelSourceKey
} from "./model-sources";
import { formatFallbackCause, formatRuntimeError } from "./runtime-messages";
import { VideoFrameScheduler } from "./media-frame-scheduler";
import { exportCanvasImage } from "./export-image";

type Language = "zh" | "en";
type Detection = PPDetectionResult["detections"][number];
type InputMode = "image" | "camera" | "video";
type Status = "ready" | "downloading" | "loading" | "running" | "success" | "error";

type DemoLoadTimings = PPDetectionLoadTimings & {
  readonly integrityMs?: number;
  readonly modelCacheReadMs?: number;
  readonly modelDownloadMs?: number;
  readonly modelSource?: "cache" | "memory" | "network";
};

type DemoRuntime = PPDetectionResult["runtime"] & {
  readonly runtimeVersion?: string | null;
  readonly environment?: {
    readonly userAgent: string | null;
    readonly platform: string | null;
    readonly capturedAt: string;
  };
};

const demoFixture = new URLSearchParams(window.location.search).has("fixture");
const ortWasmBaseUrl = new URL(`${import.meta.env.BASE_URL}ort/`, window.location.href).href;

function fixtureModel(model: DemoModelKey, source: ModelSourceKey): PPDetectionModel {
  const option = modelOption(model);
  const fixture = adaptModelManifest(tinyModelManifest);
  const selectedSource = option.manifest.variants
    .flatMap((variant) => variant.sources)
    .find((candidate) => candidate.kind === source);
  if (selectedSource === undefined)
    throw new PPDetectionError("MODEL_SOURCE_UNAVAILABLE", "当前模型没有所选来源", {
      model,
      source
    });
  const fixtureVariant = fixture.variants.find((variant) => variant.precision === "fp32")!;
  return {
    data: tinyModelData(),
    manifest: {
      ...fixture,
      model: option.manifest.model,
      variants: [
        {
          ...fixtureVariant,
          status: option.experimental ? "labs" : "stable",
          sources: [
            {
              ...selectedSource,
              bytes: fixtureVariant.bytes,
              sha256: fixtureVariant.sources[0].sha256
            }
          ]
        }
      ]
    }
  };
}

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
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null | undefined,
  result: PPDetectionResult | undefined,
  language: Language,
  showLabels: boolean,
  selected: Detection | undefined
): void {
  if (source == null || result === undefined) return;
  const width =
    source instanceof HTMLVideoElement
      ? source.videoWidth || result.image.original.width
      : source instanceof HTMLImageElement
        ? source.naturalWidth || result.image.original.width
        : source.width;
  const height =
    source instanceof HTMLVideoElement
      ? source.videoHeight || result.image.original.height
      : source instanceof HTMLImageElement
        ? source.naturalHeight || result.image.original.height
        : source.height;
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
    context.strokeStyle = detectionColor(detection.label);
    context.fillStyle = detectionFillColor(detection.label);
    context.beginPath();
    context.rect(
      detection.box.xMin,
      detection.box.yMin,
      detection.box.xMax - detection.box.xMin,
      detection.box.yMax - detection.box.yMin
    );
    context.fill();
    context.stroke();
  }

  // 按画布实际显示比例设置字号，缩小大图时标签仍保持可读。
  const displayScale = Math.min(canvas.clientWidth / width, canvas.clientHeight / height) || 1;
  const styles = getComputedStyle(canvas);
  const boxLineWidth = context.lineWidth;
  if (selected !== undefined) {
    const { xMin, yMin, xMax, yMax } = selected.box;
    // 双层描边让选中框在不同背景上清晰可见，保留原有类别颜色。
    for (const [color, thickness] of [
      [styles.getPropertyValue("--sdk-color-panel").trim(), 7],
      [detectionColor(selected.label), 3]
    ] as const) {
      context.strokeStyle = color;
      context.lineWidth = thickness / displayScale;
      context.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
    }
  }
  if (!showLabels && selected === undefined) return;
  const fontSize = 14 / displayScale;
  const padding = (Number.parseFloat(styles.getPropertyValue("--sdk-space-1")) || 4) / displayScale;
  const labelHeight = Math.min(height, fontSize + padding * 2);
  context.font = `600 ${fontSize}px ${styles.fontFamily}`;
  context.textBaseline = "middle";

  const labels = result.detections
    .filter((detection) => showLabels || detection === selected)
    .map((detection) => {
      const label = `${detectionLabel(detection.label, language)} ${(detection.score * 100).toFixed(1)}%`;
      return {
        detection,
        label,
        width: Math.min(width, context.measureText(label).width + padding * 2)
      };
    });
  const labelBoxes = layoutDetectionLabels(
    labels.map(({ detection }) => detection.box),
    labels.map(({ width: labelWidth }) => labelWidth),
    width,
    height,
    labelHeight,
    boxLineWidth / 2
  );

  // 最后绘制标签，避免其他检测框的半透明填充盖住文字。
  const labelOrder = [...labels.keys()].sort(
    (a, b) => Number(labels[a].detection === selected) - Number(labels[b].detection === selected)
  );
  for (const index of labelOrder) {
    const { detection, label, width: labelWidth } = labels[index];
    const labelBox = labelBoxes[index];
    context.fillStyle = detectionColor(detection.label);
    context.fillRect(labelBox.x, labelBox.y, labelBox.width, labelBox.height);
    context.fillStyle = styles.getPropertyValue("--sdk-color-text").trim();
    const textPadding = Math.min(padding, labelWidth / 4);
    context.fillText(
      label,
      labelBox.x + textPadding,
      labelBox.y + labelBox.height / 2,
      labelBox.width - textPadding * 2
    );
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
  const [showLabels, setShowLabels] = useState(true);
  const [selectedClasses, setSelectedClasses] = useState<ReadonlySet<string> | null>(null);
  const [targetSelection, setTargetSelection] = useState<{
    result: PPDetectionResult;
    config: string;
    detection: Detection;
  }>();
  const copy: Copy = language === "zh" ? zhCN : en;
  const [backend, setBackend] = useState<BackendPreference>("auto");
  const [precision, setPrecision] = useState<PrecisionPreference>("auto");
  const [selectedModel, setSelectedModel] = useState<DemoModelKey>(DEFAULT_MODEL);
  const [modelSource, setModelSource] = useState<ModelSourceKey>(() =>
    defaultSource(modelOption(DEFAULT_MODEL))
  );
  const [modelSourceChanging, setModelSourceChanging] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("image");
  const [threshold, setThreshold] = useState(0.5);
  const [status, setStatus] = useState<Status>("ready");
  const [detectionActive, setDetectionActive] = useState(false);
  const [downloadPercentage, setDownloadPercentage] = useState<number | undefined>();
  const [file, setFile] = useState<File | undefined>();
  const [videoFile, setVideoFile] = useState<File | undefined>();
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<readonly MediaDeviceInfo[]>([]);
  const [cameraDeviceId, setCameraDeviceId] = useState("");
  const [result, setResult] = useState<PPDetectionResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customError, setCustomError] = useState<string | undefined>();
  const [customManifest, setCustomManifest] = useState<ModelManifest | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [imageExporting, setImageExporting] = useState(false);
  const [imageExportError, setImageExportError] = useState(false);
  const [classThresholds, setClassThresholds] = useState<Record<string, number>>({});
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageViewport = useImageViewport(canvasRef, inputMode === "image" ? imageUrl : undefined);
  const resultFrameRef = useRef<
    { result: PPDetectionResult; frame: HTMLCanvasElement } | undefined
  >(undefined);
  const detectionRowsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const detectorRef = useRef<PPDetectionDetector | undefined>(undefined);
  const initializationRef = useRef<
    { detector: PPDetectionDetector; timings: DemoLoadTimings } | undefined
  >(undefined);
  const detectorConfigRef = useRef<string | undefined>(undefined);
  const runDetectionRef = useRef<
    (source: File | HTMLVideoElement, timestampMs?: number) => Promise<void>
  >(() => Promise.resolve());
  const cacheManagerRef = useRef<ModelManager | undefined>(undefined);
  const cacheIdentityRef = useRef<{ id: string; version: string }>(
    modelOption(DEFAULT_MODEL).manifest.model
  );
  const cacheClearingRef = useRef(false);
  const activeDetectionRef = useRef<Promise<void> | undefined>(undefined);
  const sourceChangingRef = useRef(false);
  const videoStartRef = useRef<AbortController | undefined>(undefined);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [cacheUsage, setCacheUsage] = useState<{ current: number; all: number }>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const inputGenerationRef = useRef(0);
  const schedulerRef = useRef<VideoFrameScheduler | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const loadTimings: DemoLoadTimings | undefined =
    initializationRef.current?.detector === detectorRef.current
      ? initializationRef.current?.timings
      : undefined;
  const runtime: DemoRuntime | undefined = result?.runtime;
  const activeModelOption = modelOption(selectedModel);
  const activeManifest = customManifest ?? activeModelOption.manifest;
  const activeSourceOptions = sourceOptions(activeModelOption);
  const activeModelSource =
    activeSourceOptions.find((option) => option.key === modelSource) ?? activeSourceOptions[0];
  const activeLabels = uniqueLabels(customManifest?.labels ?? activeModelOption.manifest.labels);
  const activeClassThresholds = selectActiveClassThresholds(activeLabels, classThresholds);
  const hasResult = result !== undefined;
  const detectorConfig = JSON.stringify({
    inputMode,
    backend,
    precision,
    selectedModel,
    modelSource,
    customManifest
  });
  const visibleResult = useMemo(
    () =>
      result === undefined || selectedClasses === null
        ? result
        : {
            ...result,
            detections: result.detections.filter(({ label }) => selectedClasses.has(label))
          },
    [result, selectedClasses]
  );

  useEffect(() => {
    setSelectedClasses(null);
  }, [hasResult, detectorConfig]);

  // 目标仅属于当前检测结果，不把数组位置当作跨帧身份。
  const selectedTarget =
    targetSelection?.result === result &&
    targetSelection?.config === detectorConfig &&
    visibleResult?.detections.includes(targetSelection.detection)
      ? targetSelection.detection
      : undefined;
  useEffect(() => {
    if (selectedTarget === undefined) setTargetSelection(undefined);
    if (result === undefined) resultFrameRef.current = undefined;
  }, [selectedTarget, result, detectorConfig]);

  const selectTarget = (detection: Detection | undefined, fromCanvas: boolean): void => {
    setTargetSelection(
      detection === undefined || result === undefined
        ? undefined
        : { result, config: detectorConfig, detection }
    );
    if (detection === undefined) return;
    if (!fromCanvas) imageViewport.focus(detection.box);
    const element = fromCanvas
      ? detectionRowsRef.current[visibleResult!.detections.indexOf(detection)]
      : imageViewport.viewportRef.current;
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const getCacheManager = (): ModelManager => (cacheManagerRef.current ??= new ModelManager());
  const refreshCache = async (): Promise<void> => {
    const manager = getCacheManager();
    const identity = cacheIdentityRef.current;
    const [current, all] = await Promise.all([
      manager.getCacheEstimate(identity),
      manager.getCacheEstimate()
    ]);
    if (cacheManagerRef.current === manager && cacheIdentityRef.current === identity)
      setCacheUsage({ current: current.bytes, all: all.bytes });
  };

  useEffect(() => {
    void refreshCache().catch(() => setCacheUsage(undefined));
    return () => {
      abortRef.current?.abort();
      videoStartRef.current?.abort();
      const manager = cacheManagerRef.current;
      cacheManagerRef.current = undefined;
      void manager?.dispose();
    };
  }, []);

  const refreshCameraDevices = useCallback(async (): Promise<void> => {
    const generation = inputGenerationRef.current;
    if (!navigator.mediaDevices?.enumerateDevices) {
      setCameraDevices([]);
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (generation !== inputGenerationRef.current) return;
      const cameras = devices.filter((device) => device.kind === "videoinput");
      setCameraDevices(cameras);
      setCameraDeviceId((current) =>
        current !== "" && cameras.some((device) => device.deviceId === current) ? current : ""
      );
    } catch {
      if (generation !== inputGenerationRef.current) return;
      setCameraDevices([]);
    }
  }, []);

  const activeMediaLabel =
    inputMode === "image"
      ? (file?.name ?? copy.noImage)
      : inputMode === "camera"
        ? cameraActive
          ? copy.cameraActive
          : copy.cameraIdle
        : (videoFile?.name ?? copy.noVideo);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const source =
      inputMode === "image"
        ? imageRef.current
        : resultFrameRef.current?.result === result && resultFrameRef.current !== undefined
          ? resultFrameRef.current.frame
          : videoRef.current;
    if (canvas === null || source === null) return;
    if (visibleResult !== undefined)
      drawResult(canvas, source, visibleResult, language, showLabels, selectedTarget);
    else if (source instanceof HTMLImageElement) drawSource(canvas, source);
    else if (source instanceof HTMLVideoElement) drawVideoSource(canvas, source);
  }, [inputMode, visibleResult, language, showLabels, selectedTarget]);

  useEffect(() => {
    if (!hasResult) setImageExportError(false);
  }, [hasResult]);

  const redrawRef = useRef(redraw);
  useEffect(() => {
    redrawRef.current = redraw;
    redraw();
  }, [redraw]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const observer = new ResizeObserver(() => redrawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    void refreshCameraDevices();
  }, [refreshCameraDevices]);
  useEffect(
    () => () => {
      if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl);
      if (videoUrl !== undefined) URL.revokeObjectURL(videoUrl);
    },
    [imageUrl, videoUrl]
  );
  useEffect(
    () => () => {
      schedulerRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const detector = detectorRef.current;
      detectorRef.current = undefined;
      initializationRef.current = undefined;
      detectorConfigRef.current = undefined;
      void detector?.dispose();
    },
    []
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
          return runDetectionRef.current(video, timestampMs);
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
    inputGenerationRef.current += 1;
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
  };

  const onVideo = (next: File | undefined): void => {
    if (next === undefined) return;
    inputGenerationRef.current += 1;
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
  };

  function stopCamera(): void {
    videoStartRef.current?.abort();
    videoStartRef.current = undefined;
    inputGenerationRef.current += 1;
    abortRef.current?.abort("media-stopped");
    abortRef.current = undefined;
    schedulerRef.current?.stop();
    schedulerRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  const startCamera = async (requestedDeviceId = cameraDeviceId): Promise<void> => {
    if (cacheClearingRef.current) return;
    stopCamera();
    const generation = inputGenerationRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(copy.cameraUnsupported);
      setStatus("error");
      return;
    }
    try {
      const video: MediaTrackConstraints =
        requestedDeviceId === "" ? {} : { deviceId: { exact: requestedDeviceId } };
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      if (generation !== inputGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeDeviceId !== undefined && activeDeviceId !== "") setCameraDeviceId(activeDeviceId);
      await refreshCameraDevices();
      if (generation !== inputGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
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
      if (generation !== inputGenerationRef.current) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = undefined;
      setCameraActive(false);
      setError(formatRuntimeError(caught));
      setStatus("error");
    }
  };

  const onCameraDeviceChange = (nextDeviceId: string): void => {
    setCameraDeviceId(nextDeviceId);
    if (cameraActive) void startCamera(nextDeviceId);
  };

  const onSample = async (sample: DemoSample): Promise<void> => {
    const generation = ++inputGenerationRef.current;
    try {
      const next = await fetchSampleFile(sample);
      if (generation !== inputGenerationRef.current) return;
      onImage(next);
    } catch (caught) {
      if (generation !== inputGenerationRef.current) return;
      setError(formatRuntimeError(caught));
      setStatus("error");
    }
  };

  const onBackend = (next: BackendPreference): void => {
    if (next !== backend) cancel();
    const nextPrecision = precisionForBackend(
      next,
      precision,
      customManifest ?? activeModelOption.manifest
    );
    setBackend(next);
    if (nextPrecision !== precision) {
      setPrecision(nextPrecision);
      setNotice(copy.precisionAdjusted);
    }
  };

  const onPrecision = (next: PrecisionPreference): void => {
    if (next !== precision) cancel();
    setPrecision(next);
  };

  const onModelSelection = async (
    nextModel: DemoModelKey,
    nextSource: ModelSourceKey
  ): Promise<void> => {
    if (cacheClearingRef.current || sourceChangingRef.current) return;
    sourceChangingRef.current = true;
    if (inputMode !== "image") stopVideo();
    cancel();
    setModelSourceChanging(true);
    try {
      await activeDetectionRef.current;
      const detector = detectorRef.current;
      detectorRef.current = undefined;
      initializationRef.current = undefined;
      detectorConfigRef.current = undefined;
      await detector?.dispose();
    } catch (caught) {
      setError(formatRuntimeError(caught));
      setStatus("error");
      setModelSourceChanging(false);
      sourceChangingRef.current = false;
      return;
    }
    setSelectedModel(nextModel);
    setModelSource(nextSource);
    cacheIdentityRef.current = modelOption(nextModel).manifest.model;
    void refreshCache().catch(() => setCacheUsage(undefined));
    setCustomManifest(undefined);
    setResult(undefined);
    setError(undefined);
    setNotice(undefined);
    setDownloadPercentage(undefined);
    setStatus("ready");
    if (imageRef.current !== null) drawSource(canvasRef.current!, imageRef.current);
    setModelSourceChanging(false);
    sourceChangingRef.current = false;
  };

  const onModel = async (next: DemoModelKey): Promise<void> => {
    const nextOption = modelOption(next);
    const nextPrecision = precisionForBackend(backend, precision, nextOption.manifest);
    await onModelSelection(next, defaultSource(nextOption));
    if (nextPrecision !== precision) {
      setPrecision(nextPrecision);
      setNotice(copy.precisionAdjusted);
    }
  };

  const onModelSource = (next: ModelSourceKey): Promise<void> =>
    onModelSelection(selectedModel, next);

  const cancel = (): void => {
    abortRef.current?.abort("cancelled");
    abortRef.current = undefined;
    setStatus("ready");
  };

  const updateClassThreshold = (label: string, value: string): void => {
    setClassThresholds((current) => setClassThresholdValue(current, label, value));
  };

  const runDetectionActive = async (
    source: File | HTMLVideoElement = file!,
    timestampMs?: number
  ): Promise<void> => {
    if (source === undefined) return;
    setTargetSelection(undefined);
    const initialize =
      inputMode === "image" ||
      detectorRef.current === undefined ||
      detectorConfigRef.current !== detectorConfig;
    if (initialize) {
      cancel();
      setError(undefined);
      setStatus("loading");
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setDownloadPercentage(undefined);
    try {
      if (initialize) {
        const previousDetector = detectorRef.current;
        detectorRef.current = undefined;
        initializationRef.current = undefined;
        detectorConfigRef.current = undefined;
        await previousDetector?.dispose();
      }
      let detector = detectorRef.current;
      if (detector === undefined) {
        const initializationStarted = performance.now();
        const model: PPDetectionModel = demoFixture
          ? fixtureModel(selectedModel, modelSource)
          : (customManifest ?? activeModelOption.manifest);
        if (typeof model === "object" && model !== null)
          cacheIdentityRef.current = "manifest" in model ? model.manifest.model : model.model;
        detector = await createPPDetection({
          ...(customManifest === undefined && activeModelOption.experimental
            ? { allowExperimental: true }
            : {}),
          allowFallback: allowFallbackForSelection(backend, precision),
          backend,
          cache: true,
          ...(model === undefined ? {} : { model }),
          onProgress: (event) => {
            if (controller.signal.aborted || abortRef.current !== controller) return;
            const nextProgress = modelProgressState(event);
            if (nextProgress === undefined) return;
            setStatus(nextProgress.status);
            setDownloadPercentage(
              nextProgress.status === "downloading" ? nextProgress.percentage : undefined
            );
          },
          ort: { wasm: { paths: ortWasmBaseUrl } },
          precision,
          ...(customManifest === undefined ? { source: modelSource } : {}),
          signal: controller.signal
        });
        if (controller.signal.aborted || abortRef.current !== controller) {
          await detector.dispose();
          return;
        }
        detectorRef.current = detector;
        detectorConfigRef.current = detectorConfig;
        initializationRef.current = {
          detector,
          timings: { ...detector.loadTimings, totalMs: performance.now() - initializationStarted }
        };
      }
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setStatus("running");
      // 推理和后续交互重绘共用这一帧，避免视频继续播放后底图与坐标错位。
      const frame =
        source instanceof HTMLVideoElement ? document.createElement("canvas") : undefined;
      if (frame !== undefined && source instanceof HTMLVideoElement) drawVideoSource(frame, source);
      const nextResult = await detector.detect(frame ?? source, {
        ...(Object.keys(activeClassThresholds).length === 0
          ? {}
          : { classThresholds: activeClassThresholds }),
        signal: controller.signal,
        threshold,
        ...(timestampMs === undefined ? {} : { timestampMs })
      });
      if (controller.signal.aborted || abortRef.current !== controller) return;
      resultFrameRef.current = frame === undefined ? undefined : { result: nextResult, frame };
      setResult(nextResult);
      setStatus(inputMode === "image" ? "success" : "running");
      await refreshCache();
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

  const runDetection = (
    source: File | HTMLVideoElement = file!,
    timestampMs?: number
  ): Promise<void> => {
    if (cacheClearingRef.current || sourceChangingRef.current || activeDetectionRef.current)
      return Promise.resolve();
    setDetectionActive(true);
    const operation = runDetectionActive(source, timestampMs);
    activeDetectionRef.current = operation;
    void operation.finally(() => {
      if (activeDetectionRef.current === operation) {
        activeDetectionRef.current = undefined;
        setDetectionActive(false);
      }
    });
    return operation;
  };
  runDetectionRef.current = runDetection;

  const startVideo = async (): Promise<void> => {
    if (cacheClearingRef.current) return;
    const video = videoRef.current;
    if (video === null || videoUrl === undefined) return;
    stopCamera();
    videoStartRef.current?.abort();
    const startup = new AbortController();
    videoStartRef.current = startup;
    const generation = inputGenerationRef.current;
    const cancelled = () => startup.signal.aborted || generation !== inputGenerationRef.current;
    setInputMode("video");
    setResult(undefined);
    setError(undefined);
    try {
      const previousDetector = detectorRef.current;
      detectorRef.current = undefined;
      initializationRef.current = undefined;
      detectorConfigRef.current = undefined;
      await previousDetector?.dispose();
      if (cancelled()) return;
      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            video.removeEventListener("loadeddata", finish);
            startup.signal.removeEventListener("abort", finish);
            resolve();
          };
          video.addEventListener("loadeddata", finish, { once: true });
          startup.signal.addEventListener("abort", finish, { once: true });
        });
      }
      if (cancelled()) return;
      await video.play();
      if (cancelled()) {
        video.pause();
        return;
      }
      schedulerRef.current = new VideoFrameScheduler(video, (timestampMs) => {
        return runDetectionRef.current(video, timestampMs);
      });
      schedulerRef.current.start();
    } catch (caught) {
      if (cancelled()) return;
      setError(formatRuntimeError(caught));
      setStatus("error");
    }
  };

  const stopVideo = (): void => {
    videoStartRef.current?.abort();
    inputGenerationRef.current += 1;
    abortRef.current?.abort("media-stopped");
    abortRef.current = undefined;
    schedulerRef.current?.stop();
    schedulerRef.current = undefined;
    videoRef.current?.pause();
    if (inputMode === "camera") stopCamera();
    setStatus("ready");
  };

  const exportImage = async (): Promise<void> => {
    const canvas = canvasRef.current;
    if (
      canvas === null ||
      result === undefined ||
      imageExporting ||
      cacheClearing ||
      modelSourceChanging
    )
      return;
    setImageExportError(false);
    setImageExporting(true);
    const generation = inputGenerationRef.current;
    try {
      await exportCanvasImage(canvas);
    } catch {
      if (generation === inputGenerationRef.current) setImageExportError(true);
    } finally {
      setImageExporting(false);
    }
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
    if (cacheClearingRef.current) return;
    try {
      const parsed = parseModelManifest(JSON.parse(customText) as unknown);
      cancel();
      setCustomManifest(parsed);
      cacheIdentityRef.current = parsed.model;
      void refreshCache().catch(() => setCacheUsage(undefined));
      setCustomError(undefined);
    } catch {
      cancel();
      setCustomManifest(undefined);
      cacheIdentityRef.current = activeModelOption.manifest.model;
      void refreshCache().catch(() => setCacheUsage(undefined));
      setCustomError(copy.invalidManifest);
    }
  };

  const clearCache = async (scope: "current" | "all"): Promise<void> => {
    if (cacheClearingRef.current || sourceChangingRef.current) return;
    cacheClearingRef.current = true;
    setCacheClearing(true);
    setNotice(undefined);
    setError(undefined);
    const identity = cacheIdentityRef.current;
    try {
      stopVideo();
      cancel();
      await activeDetectionRef.current;
      const detector = detectorRef.current;
      detectorRef.current = undefined;
      initializationRef.current = undefined;
      detectorConfigRef.current = undefined;
      await detector?.dispose();
      if (scope === "current") await getCacheManager().clearCurrentModelCache(identity);
      else await getCacheManager().clearAllCache();
      await refreshCache();
      setResult(undefined);
      setStatus("ready");
      setNotice(copy.cacheCleared);
    } catch (caught) {
      setError(formatRuntimeError(caught));
      setStatus("error");
      await refreshCache().catch(() => setCacheUsage(undefined));
    } finally {
      cacheClearingRef.current = false;
      setCacheClearing(false);
    }
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

      <div className="demo-workspace">
        <aside className="controls-panel">
          <section className="control-band" data-testid="controls">
            <label className="control-group">
              <span className="control-label">{copy.model}</span>
              <select
                aria-label={copy.model}
                disabled={cacheClearing || modelSourceChanging}
                value={selectedModel}
                onChange={(event) => void onModel(event.target.value as DemoModelKey)}
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label[language]}
                    {option.experimental ? ` (${copy.experimental})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-group">
              <span className="control-label">{copy.modelRepository}</span>
              <select
                aria-label={copy.modelRepository}
                disabled={cacheClearing || modelSourceChanging}
                value={modelSource}
                onChange={(event) => void onModelSource(event.target.value as ModelSourceKey)}
              >
                {activeSourceOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label[language]}
                  </option>
                ))}
              </select>
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
                {(["auto", "fp32", "fp16", "int8"] as const).map((value) => {
                  const unsupported =
                    value !== "auto" &&
                    precisionForBackend(
                      backend,
                      value,
                      customManifest ?? activeModelOption.manifest
                    ) !== value;
                  return (
                    <button
                      key={value}
                      className={precision === value ? "selected" : ""}
                      aria-pressed={precision === value}
                      disabled={unsupported || (inputMode !== "image" && status === "running")}
                      title={unsupported ? copy.precisionAdjusted : undefined}
                      onClick={() => onPrecision(value)}
                    >
                      {value === "int8" ? precisionLabel(value, activeManifest) : copy[value]}
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
                  onClick={() => {
                    stopVideo();
                    setInputMode("camera");
                    setResult(undefined);
                    setError(undefined);
                    void refreshCameraDevices();
                  }}
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
            {inputMode === "camera" && (
              <label className="control-group camera-device-control">
                <span className="control-label">{copy.cameraDevice}</span>
                <select
                  aria-label={copy.cameraDevice}
                  value={cameraDeviceId}
                  onChange={(event) => onCameraDeviceChange(event.target.value)}
                >
                  <option value="">{copy.defaultCamera}</option>
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>
                      {device.label || `${copy.cameraDevice} ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
                      detectionActive ||
                      cacheClearing ||
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
                    disabled={
                      cacheClearing ||
                      videoUrl === undefined ||
                      status === "running" ||
                      modelSourceChanging
                    }
                    onClick={() => void startVideo()}
                  >
                    <Check size={17} />
                    {copy.startVideo}
                  </button>
                </>
              ) : (
                <button
                  className="primary-button"
                  disabled={
                    cacheClearing || cameraActive || modelSourceChanging || status === "running"
                  }
                  onClick={() => void startCamera()}
                >
                  <Camera size={17} />
                  {copy.startCamera}
                </button>
              )}
              <button
                className="secondary-button"
                onClick={inputMode === "image" ? cancel : stopVideo}
              >
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
                  <span>{detectionLabel(label, language)}</span>
                  <input
                    aria-label={`${copy.classThreshold} ${detectionLabel(label, language)}`}
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

          <div className={`status-line ${status}`} data-testid="status" aria-live="polite">
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
        </aside>

        <section className="workspace-grid">
          <article className="result-panel" data-testid="result-panel">
            <div className="result-toolbar">
              <h2>{copy.result}</h2>
              <div className="target-selection-slot" aria-live="polite" aria-atomic="true">
                {selectedTarget !== undefined && (
                  <div className="target-selection" data-testid="selected-target">
                    <span
                      title={`${copy.selectedTarget}: ${detectionLabel(selectedTarget.label, language)} ${(selectedTarget.score * 100).toFixed(1)}%`}
                    >
                      {copy.selectedTarget}: {detectionLabel(selectedTarget.label, language)}{" "}
                      {(selectedTarget.score * 100).toFixed(1)}%
                    </span>
                    <button
                      className="text-button"
                      aria-label={copy.clearSelection}
                      title={copy.clearSelection}
                      onClick={() => setTargetSelection(undefined)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
              {inputMode === "image" && imageUrl !== undefined && (
                <div className="zoom-toolbar" role="group" aria-label={copy.imageView}>
                  <button
                    className="text-button"
                    aria-label={copy.zoomOut}
                    disabled={imageViewport.zoom <= 1}
                    onClick={() => imageViewport.zoomBy(0.8)}
                  >
                    −
                  </button>
                  <output data-testid="zoom-level" aria-label={copy.zoomLevel}>
                    {Math.round(imageViewport.zoom * 100)}%
                  </output>
                  <button
                    className="text-button"
                    aria-label={copy.zoomIn}
                    disabled={imageViewport.zoom >= 8}
                    onClick={() => imageViewport.zoomBy(1.25)}
                  >
                    +
                  </button>
                  <button className="text-button" onClick={imageViewport.reset}>
                    {copy.fitWindow}
                  </button>
                  <button
                    className="text-button"
                    aria-label={copy.resetView}
                    title={copy.resetView}
                    onClick={imageViewport.reset}
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
              <label className="label-toggle">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(event) => setShowLabels(event.target.checked)}
                />
                {copy.showLabels}
              </label>
            </div>
            <div
              ref={imageViewport.viewportRef}
              data-testid="image-viewport"
              className={`canvas-wrap ${inputMode === "image" ? (imageUrl === undefined ? "" : "image-viewport") : "media-canvas-wrap"} ${imageViewport.dragging ? "is-dragging" : ""}`}
              {...imageViewport.bindings}
              onClick={(event) => {
                const canvas = canvasRef.current;
                if (canvas === null) return;
                const bounds = canvas.getBoundingClientRect();
                selectTarget(
                  hitTestDetection(
                    visibleResult?.detections ?? [],
                    { width: canvas.width, height: canvas.height },
                    bounds,
                    { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
                  ),
                  true
                );
              }}
            >
              {inputMode === "image" && imageUrl === undefined ? (
                <div className="empty-state">
                  <FileImage size={30} />
                  <span>{copy.noImage}</span>
                  <small>{copy.selectHint}</small>
                </div>
              ) : inputMode === "camera" && !cameraActive ? (
                <div className="empty-state">
                  <Camera size={30} />
                  <span>{copy.cameraIdle}</span>
                  <small>{copy.cameraHint}</small>
                </div>
              ) : inputMode === "image" ? (
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt=""
                  className="source-image"
                  onLoad={(event) => {
                    imageRef.current = event.currentTarget;
                    imageViewport.reset();
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
                style={imageViewport.canvasStyle}
                data-testid="result-canvas"
                role="img"
                aria-label={copy.result}
                tabIndex={hasResult ? 0 : undefined}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setTargetSelection(undefined);
                }}
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
          </article>

          <aside className="details-panel" data-testid="details-panel">
            <section className="detail-section detection-section" data-testid="detection-section">
              <div className="section-title">
                <h2>{copy.result}</h2>
                <span className="count-badge">
                  {visibleResult?.detections.length ?? 0}
                  {selectedClasses !== null ? ` / ${result?.detections.length ?? 0}` : ""}{" "}
                  {copy.detections}
                </span>
              </div>
              <div className="detail-actions export-actions" data-testid="detail-actions">
                <button
                  className="text-button"
                  disabled={
                    result === undefined || imageExporting || cacheClearing || modelSourceChanging
                  }
                  onClick={() => void exportImage()}
                >
                  <Download size={16} />
                  {imageExporting ? copy.exportingImage : copy.exportImage}
                </button>
                <button
                  className="text-button"
                  disabled={result === undefined}
                  onClick={exportJson}
                >
                  <Download size={16} />
                  {copy.exportJson}
                </button>
                {imageExportError && (
                  <div className="error-banner" role="alert">
                    <CircleAlert size={18} />
                    {copy.exportImageError}
                  </div>
                )}
              </div>
              {result !== undefined && (
                <details
                  className="detail-disclosure filter-disclosure"
                  data-testid="filter-details"
                >
                  <summary className="section-title">
                    <span>{copy.filterClasses}</span>
                    <ChevronDown size={17} aria-hidden="true" />
                  </summary>
                  <ClassFilter
                    detections={result.detections}
                    selected={selectedClasses}
                    onChange={setSelectedClasses}
                    language={language}
                    copy={copy}
                  />
                </details>
              )}
              <div className="detection-list" data-testid="detection-list">
                {visibleResult?.detections.length ? (
                  visibleResult.detections.map((detection, index) => (
                    <button
                      className="detection-row"
                      type="button"
                      ref={(element) => {
                        detectionRowsRef.current[index] = element;
                      }}
                      aria-pressed={detection === selectedTarget}
                      onClick={() => selectTarget(detection, false)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setTargetSelection(undefined);
                      }}
                      key={`${detection.labelId}-${index}`}
                      style={
                        { "--detection-color": detectionColor(detection.label) } as CSSProperties
                      }
                    >
                      <span className="detection-color-dot" aria-hidden="true" />
                      <span className="detection-index">{String(index + 1).padStart(2, "0")}</span>
                      <span>
                        <strong>{detectionLabel(detection.label, language)}</strong>
                        <small>
                          {(detection.score * 100).toFixed(1)}% · {detection.box.xMin.toFixed(0)},
                          {detection.box.yMin.toFixed(0)}
                        </small>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="muted detection-empty">
                    {result === undefined
                      ? copy.awaitingDetection
                      : result.detections.length
                        ? copy.noMatchingDetections
                        : copy.noDetections}
                  </p>
                )}
              </div>
            </section>
            <section
              className="detail-section"
              data-testid="performance-section"
              data-sdk-timing="true"
            >
              <dl className="timing-summary" data-testid="timing-summary">
                <div>
                  <dt>{copy.total}</dt>
                  <dd data-testid="summary-total">{formatMs(result?.timings.totalMs)}</dd>
                </div>
                <div>
                  <dt>{copy.inference}</dt>
                  <dd data-testid="summary-inference">{formatMs(result?.timings.inferenceMs)}</dd>
                </div>
              </dl>
              <details className="detail-disclosure" data-testid="performance-details">
                <summary className="section-title">
                  <h2>{copy.performanceDetails}</h2>
                  <ChevronDown size={17} aria-hidden="true" />
                </summary>
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
                  <h3 className="timing-group-title">
                    {inputMode === "image" ? copy.detectionGroup : copy.frameDetectionGroup}
                  </h3>
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
                </div>
              </details>
            </section>
            <details
              className="detail-section detail-disclosure"
              data-testid="model-section"
              data-sdk-model-info="true"
              data-sdk-runtime-info="true"
            >
              <summary className="section-title">
                <h2>{copy.modelInfo}</h2>
                <ChevronDown size={17} aria-hidden="true" />
              </summary>
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
                      ? activeModelOption.manifestPath
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
                  <dd data-testid="model-precision">
                    {result
                      ? precisionLabel(
                          result.runtime.precision,
                          activeManifest,
                          result.model.variantId
                        )
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt>{copy.mode}</dt>
                  <dd>{result?.runtime.mode ?? "-"}</dd>
                </div>
                <div>
                  <dt>{copy.runtimeVersion}</dt>
                  <dd data-testid="runtime-version">
                    {runtime === undefined ? "-" : (runtime.runtimeVersion ?? copy.unknown)}
                  </dd>
                </div>
                <div>
                  <dt>{copy.runtimePlatform}</dt>
                  <dd>
                    {runtime === undefined ? "-" : (runtime.environment?.platform ?? copy.unknown)}
                  </dd>
                </div>
                <div>
                  <dt>{copy.runtimeUserAgent}</dt>
                  <dd className="model-source-manifest">
                    {runtime === undefined ? "-" : (runtime.environment?.userAgent ?? copy.unknown)}
                  </dd>
                </div>
                <div>
                  <dt>{copy.runtimeCapturedAt}</dt>
                  <dd>
                    {runtime === undefined
                      ? "-"
                      : (runtime.environment?.capturedAt ?? copy.unknown)}
                  </dd>
                </div>
              </dl>
            </details>
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
                        {fallback.provider} ·{" "}
                        {precisionLabel(fallback.precision, activeManifest, fallback.variantId)}
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
            <details className="detail-section detail-disclosure" data-testid="cache-section">
              <summary className="section-title">
                <h2>{copy.cacheManagement}</h2>
                <ChevronDown size={17} aria-hidden="true" />
              </summary>
              <dl className="metric-list cache-usage">
                <div>
                  <dt>{copy.currentCache}</dt>
                  <dd data-sdk-cache-usage="current">
                    {cacheUsage ? formatBytes(cacheUsage.current) : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{copy.allCache}</dt>
                  <dd data-sdk-cache-usage="all">
                    {cacheUsage ? formatBytes(cacheUsage.all) : "—"}
                  </dd>
                </div>
              </dl>
              <div className="detail-actions cache-actions">
                <button
                  className="text-button"
                  data-sdk-cache-clear="current"
                  disabled={cacheClearing || modelSourceChanging}
                  onClick={() => void clearCache("current")}
                >
                  <Trash2 size={16} />
                  {copy.clearCurrentCache}
                </button>
                <button
                  className="text-button"
                  data-sdk-cache-clear="all"
                  disabled={cacheClearing || modelSourceChanging}
                  onClick={() => void clearCache("all")}
                >
                  <Trash2 size={16} />
                  {copy.clearAllCache}
                </button>
              </div>
            </details>
          </aside>
          <section
            className="sample-gallery"
            data-testid="sample-gallery"
            aria-label={copy.samples}
          >
            <div className="sample-gallery-heading">
              <span className="control-label">{copy.samples}</span>
            </div>
            <div className="sample-grid">
              {demoSamples.map((sample) => (
                <button
                  className="sample-card"
                  key={sample.id}
                  onClick={() => void onSample(sample)}
                >
                  <img src={sampleUrl(sample)} alt={sample.label[language]} />
                </button>
              ))}
            </div>
          </section>
        </section>
      </div>

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
