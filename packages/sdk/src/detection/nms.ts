export interface NmsBox {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

export interface NmsCandidate {
  readonly index: number;
  readonly classId: number;
  readonly score: number;
  readonly box: NmsBox;
}

function area(box: NmsBox): number {
  return Math.max(0, box.xMax - box.xMin) * Math.max(0, box.yMax - box.yMin);
}

export function intersectionOverUnion(left: NmsBox, right: NmsBox): number {
  const intersection =
    Math.max(0, Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin)) *
    Math.max(0, Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin));
  const union = area(left) + area(right) - intersection;
  return union <= 0 ? 0 : intersection / union;
}

export function nonMaximumSuppression<T extends NmsCandidate>(
  candidates: readonly T[],
  iouThreshold: number
): T[] {
  const sorted = [...candidates].sort(
    (left, right) => right.score - left.score || left.index - right.index
  );
  const selected: T[] = [];
  for (const candidate of sorted) {
    const suppressed = selected.some(
      (kept) =>
        kept.classId === candidate.classId &&
        intersectionOverUnion(kept.box, candidate.box) > iouThreshold
    );
    if (!suppressed) selected.push(candidate);
  }
  return selected;
}
