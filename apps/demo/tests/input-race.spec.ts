import { expect, test } from "playwright/test";

declare global {
  interface Window {
    cameraTest: {
      requested: boolean;
      enumerating: boolean;
      release: () => void;
      stream: MediaStream;
    };
  }
}

for (const stage of ["授权", "设备枚举", "拒绝"] as const) {
  for (const action of ["图片", "停止"] as const) {
    test(`${stage}迟到时不会撤销${action}操作`, async ({ page }) => {
      await page.addInitScript(
        ({ stage }) => {
          let release!: () => void;
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const canvas = document.createElement("canvas");
          canvas.width = 40;
          canvas.height = 40;
          const state = {
            requested: false,
            enumerating: false,
            release,
            stream: canvas.captureStream(1)
          };
          window.cameraTest = state;
          Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
            configurable: true,
            value: async () => {
              state.requested = true;
              if (stage !== "设备枚举") await gate;
              if (stage === "拒绝") throw new DOMException("摄像头授权已拒绝", "NotAllowedError");
              return state.stream;
            }
          });
          Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
            configurable: true,
            value: async () => {
              if (stage === "设备枚举" && state.requested) {
                state.enumerating = true;
                await gate;
              }
              return [];
            }
          });
        },
        { stage }
      );
      await page.goto("/?fixture=1");
      await page.getByRole("button", { name: "摄像头", exact: true }).click();
      await page.getByRole("button", { name: "启动摄像头", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            (stage) =>
              stage === "设备枚举" ? window.cameraTest.enumerating : window.cameraTest.requested,
            stage
          )
        )
        .toBe(true);
      await page
        .getByRole("button", { name: action === "停止" ? "停止媒体" : action, exact: true })
        .click();
      await page.evaluate(() => window.cameraTest.release());
      if (stage !== "拒绝") {
        await expect
          .poll(() => page.evaluate(() => window.cameraTest.stream.getTracks()[0]?.readyState))
          .toBe("ended");
      }
      await page.waitForTimeout(200);
      await expect(
        page.getByRole("button", {
          name: action === "图片" ? "图片" : "摄像头",
          exact: true
        })
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("status")).not.toContainText("摄像头已启动");
      await expect(page.getByRole("alert")).toHaveCount(0);
      if (action === "停止") {
        await expect(page.getByRole("button", { name: "启动摄像头", exact: true })).toBeEnabled();
      }
    });
  }
}

test("迟到的示例不能覆盖随后上传的图片", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/samples/people.jpg", async (route) => {
    if (route.request().resourceType() !== "fetch") return route.continue();
    await gate;
    await route.continue();
  });
  await page.goto("/?fixture=1");
  await page.locator(".sample-card").first().click();
  await page.locator('input[type="file"][accept*="image"]').setInputFiles({
    name: "last.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  });
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/samples/people.jpg") &&
      response.request().resourceType() === "fetch"
  );
  release();
  await completed;
  await page.waitForTimeout(200);
  await expect(page.getByTestId("status")).toContainText("last.png");
});
