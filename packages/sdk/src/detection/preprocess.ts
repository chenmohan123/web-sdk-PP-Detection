import { PPDetectionError } from "../errors";
import type { ImageRaster } from "../input/image-source";
import type { DetectionPreprocessing } from "../types";

export interface LetterboxTransform {
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly resizedWidth: number;
  readonly resizedHeight: number;
  readonly scale: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly padLeft: number;
  readonly padTop: number;
}

export interface PreprocessedImage {
  readonly data: Float32Array;
  readonly dims: readonly [1, 3, number, number];
  readonly transform: LetterboxTransform;
}

function sampleChannel(raster: ImageRaster, x: number, y: number, channel: number): number {
  const sourceX = Math.min(raster.width - 1, Math.max(0, x));
  const sourceY = Math.min(raster.height - 1, Math.max(0, y));
  return raster.rgba[(sourceY * raster.width + sourceX) * 4 + channel];
}

function bilinearChannel(
  raster: ImageRaster,
  targetX: number,
  targetY: number,
  resizedWidth: number,
  resizedHeight: number,
  channel: number
): number {
  const sourceX = ((targetX + 0.5) * raster.width) / resizedWidth - 0.5;
  const sourceY = ((targetY + 0.5) * raster.height) / resizedHeight - 0.5;
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const dx = sourceX - x0;
  const dy = sourceY - y0;
  const top =
    sampleChannel(raster, x0, y0, channel) * (1 - dx) +
    sampleChannel(raster, x0 + 1, y0, channel) * dx;
  const bottom =
    sampleChannel(raster, x0, y0 + 1, channel) * (1 - dx) +
    sampleChannel(raster, x0 + 1, y0 + 1, channel) * dx;
  return top * (1 - dy) + bottom * dy;
}

const BICUBIC_PRECISION_BITS = 22;
const BICUBIC_PRECISION = 1 << BICUBIC_PRECISION_BITS;
const BICUBIC_ROUNDING = 1 << (BICUBIC_PRECISION_BITS - 1);

function bicubicFilter(value: number): number {
  const x = Math.abs(value);
  if (x < 1) return ((-0.5 + 2) * x - (-0.5 + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * -0.5;
  return 0;
}

interface ResampleAxis {
  readonly bounds: readonly [number, number][];
  readonly coefficients: readonly number[][];
}

function createBicubicAxis(inputSize: number, outputSize: number): ResampleAxis {
  const scale = inputSize / outputSize;
  const filterScale = Math.max(scale, 1);
  const support = 2 * filterScale;
  const axis: Array<{ bounds: [number, number]; coefficients: number[] }> = [];

  for (let output = 0; output < outputSize; output += 1) {
    const center = (output + 0.5) * scale;
    let start = Math.trunc(center - support + 0.5);
    if (start < 0) start = 0;
    let end = Math.trunc(center + support + 0.5);
    if (end > inputSize) end = inputSize;
    end -= start;

    const weights: number[] = [];
    let total = 0;
    for (let index = 0; index < end; index += 1) {
      const weight = bicubicFilter((index + start - center + 0.5) / filterScale);
      weights.push(weight);
      total += weight;
    }
    if (total !== 0) {
      for (let index = 0; index < weights.length; index += 1) {
        weights[index] = weights[index] / total;
      }
    }
    axis.push({
      bounds: [start, end],
      coefficients: weights.map((weight) =>
        Math.trunc(
          weight < 0 ? -0.5 + weight * BICUBIC_PRECISION : 0.5 + weight * BICUBIC_PRECISION
        )
      )
    });
  }

  return {
    bounds: axis.map(({ bounds }) => bounds),
    coefficients: axis.map(({ coefficients }) => coefficients)
  };
}

function clipBicubic(value: number): number {
  const rounded = value >> BICUBIC_PRECISION_BITS;
  return Math.max(0, Math.min(255, rounded));
}

interface BicubicTarget {
  readonly data: Float32Array;
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly padLeft: number;
  readonly padTop: number;
  readonly values: Float32Array;
}

function writeBicubicChannels(
  raster: ImageRaster,
  resizedWidth: number,
  resizedHeight: number,
  target: BicubicTarget
): void {
  const horizontal = createBicubicAxis(raster.width, resizedWidth);
  const vertical = createBicubicAxis(raster.height, resizedHeight);
  const rowStride = resizedWidth * 3;
  const intermediate = new Uint8Array(raster.height * rowStride);

  // 三个通道共享系数和像素索引；每个通道仍按原顺序累加及舍入。
  for (let y = 0; y < raster.height; y += 1) {
    const sourceRow = y * raster.width * 4;
    const targetRow = y * rowStride;
    for (let x = 0; x < resizedWidth; x += 1) {
      const [start, count] = horizontal.bounds[x];
      const coefficients = horizontal.coefficients[x];
      let red = BICUBIC_ROUNDING;
      let green = BICUBIC_ROUNDING;
      let blue = BICUBIC_ROUNDING;
      let source = sourceRow + start * 4;
      for (let index = 0; index < count; index += 1) {
        const coefficient = coefficients[index];
        red += raster.rgba[source] * coefficient;
        green += raster.rgba[source + 1] * coefficient;
        blue += raster.rgba[source + 2] * coefficient;
        source += 4;
      }
      const offset = targetRow + x * 3;
      intermediate[offset] = clipBicubic(red);
      intermediate[offset + 1] = clipBicubic(green);
      intermediate[offset + 2] = clipBicubic(blue);
    }
  }

  const plane = target.inputWidth * target.inputHeight;
  for (let y = 0; y < resizedHeight; y += 1) {
    const [start, count] = vertical.bounds[y];
    const coefficients = vertical.coefficients[y];
    const sourceRow = start * rowStride;
    const targetRow = (y + target.padTop) * target.inputWidth + target.padLeft;
    for (let x = 0; x < resizedWidth; x += 1) {
      let red = BICUBIC_ROUNDING;
      let green = BICUBIC_ROUNDING;
      let blue = BICUBIC_ROUNDING;
      let source = sourceRow + x * 3;
      for (let index = 0; index < count; index += 1) {
        const coefficient = coefficients[index];
        red += intermediate[source] * coefficient;
        green += intermediate[source + 1] * coefficient;
        blue += intermediate[source + 2] * coefficient;
        source += rowStride;
      }
      // 保留垂直重采样后的 8 位裁剪，直接写入最终 CHW 张量。
      const offset = targetRow + x;
      target.data[offset] = target.values[clipBicubic(red)];
      target.data[plane + offset] = target.values[256 + clipBicubic(green)];
      target.data[plane * 2 + offset] = target.values[512 + clipBicubic(blue)];
    }
  }
}

export function preprocessImage(
  raster: ImageRaster,
  preprocessing: DetectionPreprocessing
): PreprocessedImage {
  const inputWidth = preprocessing.size.width;
  const inputHeight = preprocessing.size.height;
  const doResize = preprocessing.doResize ?? true;
  if (!doResize && (raster.width > inputWidth || raster.height > inputHeight)) {
    throw new PPDetectionError("INVALID_INPUT", "禁用缩放时，输入图像尺寸不能超过模型输入尺寸", {
      inputSize: { width: inputWidth, height: inputHeight },
      imageSize: { width: raster.width, height: raster.height }
    });
  }
  const resizeMode = preprocessing.resizeMode ?? "letterbox";
  const scale = doResize ? Math.min(inputWidth / raster.width, inputHeight / raster.height) : 1;
  const resizedWidth = doResize
    ? resizeMode === "stretch"
      ? inputWidth
      : Math.max(1, Math.min(inputWidth, Math.round(raster.width * scale)))
    : Math.min(inputWidth, raster.width);
  const resizedHeight = doResize
    ? resizeMode === "stretch"
      ? inputHeight
      : Math.max(1, Math.min(inputHeight, Math.round(raster.height * scale)))
    : Math.min(inputHeight, raster.height);
  const scaleX = resizedWidth / raster.width;
  const scaleY = resizedHeight / raster.height;
  const padLeft = resizeMode === "stretch" ? 0 : Math.floor((inputWidth - resizedWidth) / 2);
  const padTop = resizeMode === "stretch" ? 0 : Math.floor((inputHeight - resizedHeight) / 2);
  const plane = inputWidth * inputHeight;
  const data = new Float32Array(plane * 3);
  const normalize = preprocessing.doNormalize ?? true;
  const rescale = preprocessing.doRescale ?? true;
  const mean = normalize ? (preprocessing.mean ?? [0, 0, 0]) : [0, 0, 0];
  const std = normalize ? (preprocessing.std ?? [1, 1, 1]) : [1, 1, 1];
  const interpolation = preprocessing.interpolation ?? "bilinear";

  const bicubicValues =
    doResize && interpolation === "bicubic" ? new Float32Array(256 * 3) : undefined;

  for (let channel = 0; channel < 3; channel += 1) {
    const padding = normalize && mean[channel] !== 0 ? -mean[channel] / std[channel] : 0;
    data.fill(padding, channel * plane, (channel + 1) * plane);
    if (bicubicValues) {
      // bicubic 的裁剪输出只有 256 个值，按相同公式预计算 Float32 归一化结果。
      for (let pixel = 0; pixel < 256; pixel += 1) {
        const scaled = rescale ? pixel * preprocessing.rescaleFactor : pixel;
        bicubicValues[channel * 256 + pixel] = normalize
          ? (scaled - mean[channel]) / std[channel]
          : scaled;
      }
      continue;
    }
    for (let y = 0; y < resizedHeight; y += 1) {
      for (let x = 0; x < resizedWidth; x += 1) {
        const pixel = doResize
          ? bilinearChannel(raster, x, y, resizedWidth, resizedHeight, channel)
          : sampleChannel(raster, x, y, channel);
        const scaled = rescale ? pixel * preprocessing.rescaleFactor : pixel;
        data[channel * plane + (y + padTop) * inputWidth + x + padLeft] = normalize
          ? (scaled - mean[channel]) / std[channel]
          : scaled;
      }
    }
  }
  if (bicubicValues) {
    writeBicubicChannels(raster, resizedWidth, resizedHeight, {
      data,
      inputWidth,
      inputHeight,
      padLeft,
      padTop,
      values: bicubicValues
    });
  }

  return {
    data,
    dims: [1, 3, inputHeight, inputWidth],
    transform: {
      inputWidth,
      inputHeight,
      originalWidth: raster.width,
      originalHeight: raster.height,
      resizedWidth,
      resizedHeight,
      scale,
      scaleX,
      scaleY,
      padLeft,
      padTop
    }
  };
}
