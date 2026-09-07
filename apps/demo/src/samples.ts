export interface DemoSample {
  readonly coverage: Readonly<{ en: string; zh: string }>;
  readonly filename: string;
  readonly id: string;
  readonly label: Readonly<{ en: string; zh: string }>;
  readonly mimeType: string;
  readonly sha256: string;
  readonly sourceUrl: string;
}

export const demoSamples: readonly DemoSample[] = [
  {
    coverage: { en: "People · COCO", zh: "人物 · COCO" },
    filename: "people.jpg",
    id: "people",
    label: { en: "People", zh: "人物" },
    mimeType: "image/jpeg",
    sha256: "fc23e512cfe33e0b7f5e3445dc4189eb053fed6a16964b2454775a6df3fa5eba",
    sourceUrl:
      "https://github.com/PaddlePaddle/PaddleDetection/blob/7a4fc2578e9542d94df12907c10ec3b449be5f1e/demo/000000014439.jpg"
  },
  {
    coverage: { en: "Street · COCO", zh: "街景 · COCO" },
    filename: "street.jpg",
    id: "street",
    label: { en: "Street scene", zh: "街景" },
    mimeType: "image/jpeg",
    sha256: "c6cfc7e454a432c31ac3c3a997d5f33ccebe120fc6b9465965609ce12995ede9",
    sourceUrl:
      "https://github.com/PaddlePaddle/PaddleDetection/blob/7a4fc2578e9542d94df12907c10ec3b449be5f1e/demo/000000087038.jpg"
  },
  {
    coverage: { en: "Car · PaddleDetection", zh: "轿车 · PaddleDetection" },
    filename: "vehicles.jpg",
    id: "vehicles",
    label: { en: "Vehicles", zh: "车辆" },
    mimeType: "image/jpeg",
    sha256: "b6d75247fcd88918054fdbcd09864e3d303de064d28ca18766b8568a31c0d898",
    sourceUrl:
      "https://github.com/PaddlePaddle/PaddleDetection/blob/7a4fc2578e9542d94df12907c10ec3b449be5f1e/demo/car.jpg"
  },
  {
    coverage: { en: "Orange · PaddleDetection", zh: "橙子 · PaddleDetection" },
    filename: "fruit.jpg",
    id: "fruit",
    label: { en: "Fruit", zh: "水果" },
    mimeType: "image/jpeg",
    sha256: "2944d28ce100c8514d2aa76cb85ad539c809890c5f9f313ae8c2d99882ec85c1",
    sourceUrl:
      "https://github.com/PaddlePaddle/PaddleDetection/blob/7a4fc2578e9542d94df12907c10ec3b449be5f1e/demo/orange_71.jpg"
  }
];

export function sampleUrl(sample: DemoSample): string {
  return `${import.meta.env.BASE_URL}samples/${sample.filename}`;
}

export async function fetchSampleFile(sample: DemoSample): Promise<File> {
  const response = await fetch(sampleUrl(sample));
  if (!response.ok) throw new Error(`Unable to load sample ${sample.filename}`);
  return new File([await response.blob()], sample.filename, { type: sample.mimeType });
}
