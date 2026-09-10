export async function exportCanvasImage(canvas: HTMLCanvasElement): Promise<void> {
  // toBlob 在调用时取得位图快照，异步编码期间后续视频帧不会改变导出内容。
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((encoded) => {
      if (encoded === null) reject(new Error("PNG 编码失败"));
      else resolve(encoded);
    }, "image/png");
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = "pp-detection-result.png";
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // 等浏览器接管下载后释放对象 URL。
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
