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

function overlaps(first: LabelBox, second: LabelBox): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
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
    const available = candidates.find(
      (candidate) => !placed.some((previous) => overlaps(candidate, previous))
    );
    placed.push(available ?? candidates[0]);
  }
  return placed;
}
