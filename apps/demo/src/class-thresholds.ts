export function uniqueLabels(labels: readonly string[]): readonly string[] {
  return [...new Set(labels)];
}

export const DEFAULT_CLASS_LABELS = uniqueLabels([
  "person",
  "bicycle",
  "car",
  "motorcycle",
  "airplane",
  "bus",
  "train",
  "truck",
  "boat",
  "traffic light",
  "fire hydrant",
  "stop sign",
  "parking meter",
  "bench",
  "bird",
  "cat",
  "dog",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
  "backpack",
  "umbrella",
  "handbag",
  "tie",
  "suitcase",
  "frisbee",
  "skis",
  "snowboard",
  "sports ball",
  "kite",
  "baseball bat",
  "baseball glove",
  "skateboard",
  "surfboard",
  "tennis racket",
  "bottle",
  "wine glass",
  "cup",
  "fork",
  "knife",
  "spoon",
  "bowl",
  "banana",
  "apple",
  "sandwich",
  "orange",
  "broccoli",
  "carrot",
  "hot dog",
  "pizza",
  "donut",
  "cake",
  "chair",
  "couch",
  "potted plant",
  "bed",
  "dining table",
  "toilet",
  "tv",
  "laptop",
  "mouse",
  "remote",
  "keyboard",
  "cell phone",
  "microwave",
  "oven",
  "toaster",
  "sink",
  "refrigerator",
  "book",
  "clock",
  "vase",
  "scissors",
  "teddy bear",
  "hair drier",
  "toothbrush"
]);

function createThresholdRecord(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

export function classThresholdValue(
  thresholds: Readonly<Record<string, number>>,
  label: string
): number | "" {
  return Object.hasOwn(thresholds, label) ? thresholds[label] : "";
}

export function setClassThresholdValue(
  thresholds: Readonly<Record<string, number>>,
  label: string,
  value: string
): Record<string, number> {
  const next = Object.assign(createThresholdRecord(), thresholds);
  if (value === "") delete next[label];
  else next[label] = Number(value);
  return next;
}

export function selectActiveClassThresholds(
  labels: readonly string[],
  thresholds: Readonly<Record<string, number>>
): Readonly<Record<string, number>> {
  const selected = createThresholdRecord();
  for (const label of uniqueLabels(labels)) {
    if (Object.hasOwn(thresholds, label)) selected[label] = thresholds[label]!;
  }
  return selected;
}
