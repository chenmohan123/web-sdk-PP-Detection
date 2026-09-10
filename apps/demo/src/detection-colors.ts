const DETECTION_COLORS = [
  "#e4572e",
  "#2563eb",
  "#7c3aed",
  "#0f766e",
  "#ca8a04",
  "#db2777",
  "#0891b2",
  "#65a30d"
] as const;

export function detectionColor(label: string): string {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) | 0;
  }
  return DETECTION_COLORS[(hash >>> 0) % DETECTION_COLORS.length];
}

export function detectionFillColor(label: string): string {
  return `${detectionColor(label)}1f`;
}
