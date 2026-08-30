import { describe, expect, it, vi } from "vitest";
import { PPDetectionError } from "../src/errors";
import { decodeImageSource } from "../src/input/decode-image";
import { preprocessImage } from "../src/detection/preprocess";

describe("preprocessImage", () => {
  it("忽略透明通道并按 RGB/CHW 排列和归一化", () => {
    const result = preprocessImage(
      {
        width: 1,
        height: 1,
        rgba: new Uint8ClampedArray([10, 20, 30, 0])
      },
      {
        size: { width: 1, height: 1 },
        rescaleFactor: 0.1,
        mean: [1, 1, 1],
        std: [2, 4, 5]
      }
    );

    expect(result.data[0]).toBeCloseTo(0);
    expect(result.data[1]).toBeCloseTo(0.25);
    expect(result.data[2]).toBeCloseTo(0.4);
    expect(result.dims).toEqual([1, 3, 1, 1]);
  });

  it("保持宽高比并记录 letterbox 比例和 padding", () => {
    const result = preprocessImage(
      {
        width: 4,
        height: 2,
        rgba: new Uint8ClampedArray(4 * 2 * 4).fill(255)
      },
      {
        size: { width: 4, height: 4 },
        rescaleFactor: 1 / 255
      }
    );

    expect(result.transform).toEqual({
      inputWidth: 4,
      inputHeight: 4,
      originalWidth: 4,
      originalHeight: 2,
      resizedWidth: 4,
      resizedHeight: 2,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      padLeft: 0,
      padTop: 1
    });
    expect(result.data[0]).toBe(0);
    expect(result.data[4]).toBe(1);
  });

  it("按 stretch 模式直接缩放到模型尺寸且不添加 padding", () => {
    const result = preprocessImage(
      {
        width: 4,
        height: 2,
        rgba: new Uint8ClampedArray(4 * 2 * 4).fill(255)
      },
      {
        size: { width: 4, height: 4 },
        rescaleFactor: 1 / 255,
        resizeMode: "stretch"
      }
    );

    expect(result.transform).toMatchObject({
      resizedWidth: 4,
      resizedHeight: 4,
      scaleX: 1,
      scaleY: 2,
      padLeft: 0,
      padTop: 0
    });
    expect(Array.from(result.data.slice(0, 4))).toEqual([1, 1, 1, 1]);
    expect(Array.from(result.data.slice(4 * 4 - 4, 4 * 4))).toEqual([1, 1, 1, 1]);
  });

  it("按 bicubic 插值生成与官方 PicoDet 一致的像素", () => {
    const result = preprocessImage(
      {
        width: 2,
        height: 2,
        rgba: new Uint8ClampedArray([
          0, 0, 0, 255, 100, 100, 100, 255, 150, 150, 150, 255, 255, 255, 255, 255
        ])
      },
      {
        size: { width: 4, height: 4 },
        rescaleFactor: 1,
        resizeMode: "stretch",
        doRescale: false,
        doNormalize: false,
        interpolation: "bicubic"
      }
    );

    expect(Array.from(result.data.slice(0, 16))).toEqual([
      0, 8, 65, 96, 29, 52, 111, 139, 112, 141, 201, 225, 153, 185, 247, 255
    ]);
  });

  it("禁用缩放时拒绝超过模型输入尺寸的图像", () => {
    expect(() =>
      preprocessImage(
        {
          width: 5,
          height: 2,
          rgba: new Uint8ClampedArray(5 * 2 * 4).fill(255)
        },
        {
          size: { width: 4, height: 4 },
          rescaleFactor: 1 / 255,
          doResize: false
        }
      )
    ).toThrowError(expect.objectContaining<Partial<PPDetectionError>>({ code: "INVALID_INPUT" }));
  });
});

describe("decodeImageSource", () => {
  it("直接读取 ImageData 形状并复制 RGBA 数据", async () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 4]);
    const decoded = await decodeImageSource({ width: 1, height: 1, data: rgba } as ImageData);

    expect(decoded).toMatchObject({ width: 1, height: 1 });
    expect(Array.from(decoded.rgba)).toEqual([1, 2, 3, 4]);
    expect(decoded.rgba).not.toBe(rgba);
    expect(decoded.decodeMs).toBeGreaterThanOrEqual(0);
  });

  it("Blob 只关闭 SDK 自己创建的 ImageBitmap", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const decoded = await decodeImageSource(new Blob(["image"]), {
      createImageBitmap: vi.fn(async () => ({ width: 2, height: 1, close })),
      createCanvas: () => ({
        getContext: () => ({
          drawImage,
          getImageData: () => ({ data: new Uint8ClampedArray(8).fill(7) })
        })
      })
    });

    expect(decoded).toMatchObject({ width: 2, height: 1 });
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Canvas 像素读取失败时返回包含 CORS 提示的 INVALID_INPUT", async () => {
    const input = { width: 1, height: 1 } as HTMLCanvasElement;
    await expect(
      decodeImageSource(input, {
        createCanvas: () => ({
          getContext: () => ({
            drawImage: vi.fn(),
            getImageData: () => {
              throw new DOMException("tainted", "SecurityError");
            }
          })
        })
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT", details: { cors: true } });
  });
});
