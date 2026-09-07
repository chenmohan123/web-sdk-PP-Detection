<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import {
  createPPDetection,
  PPDetectionError,
  type PPDetectionDetector
} from "web-sdk-pp-detection";

const manifestUrl =
  "https://www.modelscope.cn/models/chenmohan/web-sdk-pp-detection/resolve/master/manifest.json?v=1.0.1";
const file = ref<File>();
const busy = ref(false);
const status = ref("请选择图片，默认从 ModelScope 加载官方 PicoDet 模型");
const progress = ref(0);
const output = ref("");
let controller: AbortController | undefined;
let mounted = true;
onUnmounted(() => {
  mounted = false;
  controller?.abort();
  // 初始化迟到或推理结束时，finally 统一 dispose。
});

async function detect(): Promise<void> {
  if (!file.value || controller) return;
  const operation = new AbortController();
  controller = operation;
  busy.value = true;
  output.value = "";
  let detector: PPDetectionDetector | undefined;
  const current = () => mounted && !operation.signal.aborted;
  try {
    detector = await createPPDetection({
      model: manifestUrl,
      source: "modelscope",
      backend: "auto",
      allowFallback: true,
      executionMode: "main",
      signal: operation.signal,
      onProgress: (event) => {
        if (!current()) return;
        status.value = `${event.phase}: ${event.status}`;
        if (event.totalBytes) progress.value = ((event.loadedBytes ?? 0) / event.totalBytes) * 100;
      }
    });
    if (!current()) return;
    const result = await detector.detect(file.value, { threshold: 0.5, signal: operation.signal });
    if (!current()) return;
    output.value = JSON.stringify(result, null, 2);
    progress.value = 100;
    status.value = `检测完成：${result.detections.length} 个目标`;
  } catch (error) {
    if (current())
      output.value = JSON.stringify(
        error instanceof PPDetectionError
          ? { code: error.code, message: error.message, details: error.details }
          : { message: String(error) },
        null,
        2
      );
  } finally {
    try {
      await detector?.dispose();
    } finally {
      controller = undefined;
      if (mounted) {
        busy.value = false;
        if (operation.signal.aborted) status.value = "已取消并释放模型";
      }
    }
  }
}
</script>

<template>
  <main>
    <h1>Vue 示例</h1>
    <input
      type="file"
      accept="image/*"
      :disabled="busy"
      @change="file = ($event.target as HTMLInputElement).files?.[0]"
    />
    <button :disabled="busy || !file" @click="detect">检测</button>
    <button :disabled="!busy" @click="controller?.abort()">取消</button>
    <p>{{ status }}</p>
    <progress max="100" :value="progress" />
    <pre>{{ output }}</pre>
  </main>
</template>
