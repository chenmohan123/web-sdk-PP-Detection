import { PPDetectionError } from "../errors";
import type { DecodedImage, ImageRaster, ImageSource } from "./image-source";

interface DrawableImage {
  readonly width?: number;
  readonly height?: number;
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  readonly videoWidth?: number;
  readonly videoHeight?: number;
  readonly displayWidth?: number;
  readonly displayHeight?: number;
  close?(): void;
}

interface RasterContext {
  drawImage(source: unknown, dx: number, dy: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
}

interface RasterCanvas {
  getContext(type: "2d", options?: CanvasRenderingContext2DSettings): RasterContext | null;
}

export interface DecodeImageEnvironment {
  readonly createCanvas?: (width: number, height: number) => RasterCanvas;
  readonly createImageBitmap?: (source: Blob) => Promise<DrawableImage>;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

function nowDefault(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PPDetectionError("ABORTED", "图片解码已取消", { reason: signal.reason });
  }
}

function isImageDataLike(value: unknown): value is {
  width: number;
  height: number;
  data?: Uint8ClampedArray;
  rgba?: Uint8ClampedArray;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "width" in value &&
    "height" in value &&
    (("data" in value && value.data instanceof Uint8ClampedArray) ||
      ("rgba" in value && value.rgba instanceof Uint8ClampedArray))
  );
}

function validateRaster(raster: ImageRaster): ImageRaster {
  if (
    !Number.isInteger(raster.width) ||
    !Number.isInteger(raster.height) ||
    raster.width <= 0 ||
    raster.height <= 0 ||
    raster.rgba.length !== raster.width * raster.height * 4
  ) {
    throw new PPDetectionError("INVALID_INPUT", "图片尺寸或 RGBA 数据无效", {
      width: raster.width,
      height: raster.height,
      rgbaLength: raster.rgba.length
    });
  }
  return raster;
}

function dimensions(source: DrawableImage): { width: number; height: number } {
  return {
    width: source.naturalWidth ?? source.videoWidth ?? source.displayWidth ?? source.width ?? 0,
    height: source.naturalHeight ?? source.videoHeight ?? source.displayHeight ?? source.height ?? 0
  };
}

function defaultCreateCanvas(width: number, height: number): RasterCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document === "object") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new PPDetectionError("INVALID_INPUT", "当前环境没有可用的 Canvas 2D 实现");
}

function invalidDecode(error: unknown): PPDetectionError {
  if (error instanceof PPDetectionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const cors =
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "SecurityError") ||
    /cors|cross.origin|taint|security/i.test(message);
  return new PPDetectionError(
    "INVALID_INPUT",
    cors ? "无法从媒体读取像素，请检查 CORS 响应头和 Canvas 跨域限制" : "无法解码或读取图片像素",
    { cors, causeMessage: message },
    { cause: error }
  );
}

export async function decodeImageSource(
  input: ImageSource,
  environment: DecodeImageEnvironment = {}
): Promise<DecodedImage> {
  const clock = environment.now ?? nowDefault;
  const startedAt = clock();
  throwIfAborted(environment.signal);

  if (isImageDataLike(input)) {
    const raster = validateRaster({
      width: input.width,
      height: input.height,
      rgba: new Uint8ClampedArray(input.data ?? input.rgba!)
    });
    return { ...raster, decodeMs: Math.max(0, clock() - startedAt) };
  }

  let ownedBitmap: DrawableImage | undefined;
  try {
    let source: DrawableImage;
    if (typeof Blob !== "undefined" && input instanceof Blob) {
      const createBitmap = environment.createImageBitmap ?? globalThis.createImageBitmap;
      if (typeof createBitmap !== "function") {
        throw new PPDetectionError("INVALID_INPUT", "当前环境不支持 Blob 图片解码");
      }
      ownedBitmap = await createBitmap(input);
      source = ownedBitmap;
    } else {
      source = input as DrawableImage;
    }

    throwIfAborted(environment.signal);
    const { width, height } = dimensions(source);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new PPDetectionError("INVALID_INPUT", "图片宽高必须是正整数", { width, height });
    }
    const canvas = (environment.createCanvas ?? defaultCreateCanvas)(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new PPDetectionError("INVALID_INPUT", "无法创建 Canvas 2D 上下文");

    // VideoFrame 的所有权始终属于调用方；这里只绘制一次，不调用 close()。
    context.drawImage(source, 0, 0);
    const rgba = new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
    throwIfAborted(environment.signal);
    const raster = validateRaster({ width, height, rgba });
    return { ...raster, decodeMs: Math.max(0, clock() - startedAt) };
  } catch (error) {
    throw invalidDecode(error);
  } finally {
    ownedBitmap?.close?.();
  }
}
