export interface ImageRaster {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

export type ImageSource =
  | Blob
  | File
  | ImageBitmap
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageData
  | VideoFrame
  | ImageRaster;

export interface DecodedImage extends ImageRaster {
  readonly decodeMs: number;
}
