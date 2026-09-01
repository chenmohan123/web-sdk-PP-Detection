<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import {
  createPPDetection,
  PPDetectionError,
  type PPDetectionDetector,
  type PPDetectionResult
} from "web-sdk-pp-detection";

const detector = ref<PPDetectionDetector>();
const file = ref<File>();
const status = ref("请选择图片");
const progress = ref(0);
const result = ref<PPDetectionResult>();
const error = ref<{ code?: string; message: string }>();

onUnmounted(() => {
  void detector.value?.dispose();
});

function selectImage(event: Event): void {
  file.value = (event.target as HTMLInputElement).files?.[0];
}
async function detect(): Promise<void> {
  if (file.value === undefined) return;
  error.value = undefined;
  try {
    await detector.value?.dispose();
    detector.value = await createPPDetection({
      onProgress: (event) => {
        status.value = `${event.phase}: ${event.status}`;
        if (event.totalBytes !== undefined)
          progress.value = ((event.loadedBytes ?? 0) / event.totalBytes) * 100;
      }
    });
    result.value = await detector.value.detect(file.value, { threshold: 0.5 });
    progress.value = 100;
    status.value = "检测完成";
  } catch (caught) {
    error.value =
      caught instanceof PPDetectionError
        ? { code: caught.code, message: caught.message }
        : { message: String(caught) };
  }
}
</script>

<template>
  <main>
    <h1>Vue 示例</h1>
    <input type="file" accept="image/*" @change="selectImage" /><button @click="detect">
      检测
    </button>
    <p>{{ status }}</p>
    <progress max="100" :value="progress" />
    <pre>{{ JSON.stringify(error ?? result, null, 2) }}</pre>
  </main>
</template>
