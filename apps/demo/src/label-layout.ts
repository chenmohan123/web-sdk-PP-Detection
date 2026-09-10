export type LabelBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type DetectionBox = {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
};

function overlapArea(first: LabelBox, second: LabelBox): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  );
  return width * height;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

export function layoutDetectionLabels(
  boxes: readonly DetectionBox[],
  widths: readonly number[],
  canvasWidth: number,
  canvasHeight: number,
  labelHeight: number,
  gap: number
): LabelBox[] {
  const height = Math.min(Math.max(0, labelHeight), Math.max(0, canvasHeight));
  const placed: LabelBox[] = [];
  for (const [index, box] of boxes.entries()) {
    const width = Math.min(Math.max(0, widths[index] ?? 0), Math.max(0, canvasWidth));
    const candidates = [
      { x: box.xMin, y: box.yMin - height - gap },
      { x: box.xMin, y: box.yMax + gap },
      { x: box.xMax + gap, y: box.yMin },
      { x: box.xMin - width - gap, y: box.yMin }
    ].map((candidate) => ({
      x: clamp(candidate.x, 0, Math.max(0, canvasWidth - width)),
      y: clamp(candidate.y, 0, Math.max(0, canvasHeight - height)),
      width,
      height
    }));
    let best = candidates[0];
    let leastOverlap = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const area = placed.reduce((sum, previous) => sum + overlapArea(candidate, previous), 0);
      // 同分时保留上、下、右、左的优先级；无空位时减少被遮挡的文字。
      if (area < leastOverlap) {
        best = candidate;
        leastOverlap = area;
      }
      if (area === 0) break;
    }
    placed.push(best);
  }
  return placed;
}
