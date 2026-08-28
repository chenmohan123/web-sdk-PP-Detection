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

  for (let channel = 0; channel < 3; channel += 1) {
    const padding = normalize && mean[channel] !== 0 ? -mean[channel] / std[channel] : 0;
    data.fill(padding, channel * plane, (channel + 1) * plane);
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
