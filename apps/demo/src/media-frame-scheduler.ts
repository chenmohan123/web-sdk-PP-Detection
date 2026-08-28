export interface VideoFrameCallbackTarget {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export type VideoFrameHandler = (timestampMs: number) => Promise<void> | void;

export class VideoFrameScheduler {
  private running = false;
  private handle: number | undefined;
  private generation = 0;

  constructor(
    private readonly target: VideoFrameCallbackTarget,
    private readonly handler: VideoFrameHandler
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.schedule(this.generation);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    if (this.handle !== undefined) {
      this.target.cancelVideoFrameCallback?.(this.handle);
      if (this.target.requestVideoFrameCallback !== undefined) this.handle = undefined;
      else globalThis.clearTimeout(this.handle);
      this.handle = undefined;
    }
  }

  private schedule(generation: number): void {
    if (!this.running || generation !== this.generation) return;
    const callback = (timestampMs: number): void => {
      this.handle = undefined;
      if (!this.running || generation !== this.generation) return;
      Promise.resolve()
        .then(() => this.handler(timestampMs))
        .catch(() => undefined)
        .finally(() => this.schedule(generation));
    };
    if (this.target.requestVideoFrameCallback !== undefined) {
      this.handle = this.target.requestVideoFrameCallback(callback);
      return;
    }
    this.handle = globalThis.setTimeout(
      () => callback(globalThis.performance?.now() ?? Date.now()),
      16
    ) as unknown as number;
  }
}
