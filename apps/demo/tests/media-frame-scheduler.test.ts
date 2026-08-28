import { expect, test } from "playwright/test";

test("视频帧调度器不会并发推理并能在 stop 后停止回调", async ({ page }) => {
  await page.goto("/?fixture=1");
  const result = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as typeof import("../src/media-frame-scheduler");
    let callbackCount = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const callbacks: number[] = [];
    let nextId = 0;
    const pending = new Map<number, (now: number) => void>();
    const video = {
      requestVideoFrameCallback(callback: (now: number) => void): number {
        const id = ++nextId;
        pending.set(id, callback);
        return id;
      },
      cancelVideoFrameCallback(id: number): void {
        pending.delete(id);
      }
    };
    const scheduler = new module.VideoFrameScheduler(video, async (timestampMs) => {
      callbackCount += 1;
      callbacks.push(timestampMs);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
    });

    scheduler.start();
    const first = pending.entries().next().value as [number, (now: number) => void];
    pending.delete(first[0]);
    first[1](100);
    if (pending.size !== 0) throw new Error(`expected no pending callback, got ${pending.size}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = pending.entries().next().value as [number, (now: number) => void];
    pending.delete(second[0]);
    second[1](200);
    await new Promise((resolve) => setTimeout(resolve, 15));
    scheduler.stop();
    const scheduledAfterStop = pending.size;
    for (const [id, callback] of pending) {
      pending.delete(id);
      callback(300);
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { callbackCount, callbacks, maxInFlight, scheduledAfterStop, pending: pending.size };
  }, "/src/media-frame-scheduler.ts");

  expect(result).toEqual({
    callbackCount: 2,
    callbacks: [100, 200],
    maxInFlight: 1,
    scheduledAfterStop: 0,
    pending: 0
  });
});
