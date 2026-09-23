import { chromium } from "file:///F:/git/00_chenmohan/github/web-sdk-PP-Detection/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
const server = createServer((q, r) => r.end("<!doctype html><title>WebNN 验证</title>"));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: [
    "--enable-features=WebMachineLearningNeuralNetwork",
    "--enable-logging",
    "--log-file=" + process.env.TEMP + "/ppdetection-webnn-browser.log",
    "--vmodule=*webnn*=2,*ml_context*=2,*tflite*=2"
  ]
});
try {
  const internal = await browser.newPage();
  await internal.goto("edge://webnn-internals");
  await internal.waitForFunction(
    () => customElements.get("webnn-internals-app"),
    {},
    { timeout: 10000 }
  );
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const probe = await page.evaluate(async () => {
    globalThis.context = await navigator.ml.createContext({ deviceType: "npu" });
    const builder = new MLGraphBuilder(globalThis.context);
    const descriptor = { dataType: "float32", shape: [4] };
    globalThis.graph = await builder.build({ y: builder.relu(builder.input("x", descriptor)) });
    const input = await context.createTensor({ ...descriptor, writable: true });
    const output = await context.createTensor({ ...descriptor, readable: true });
    context.writeTensor(input, new Float32Array([-1, 2, -3, 4]));
    context.dispatch(graph, { x: input }, { y: output });
    const values = Array.from(new Float32Array(await context.readTensor(output)));
    input.destroy();
    output.destroy();
    return { requestedDeviceType: "npu", operation: "relu", values };
  });
  const dump = () => {
    function read(root) {
      return [...root.childNodes]
        .map((n) =>
          n.nodeType === Node.TEXT_NODE
            ? n.textContent
            : n.nodeType === Node.ELEMENT_NODE
              ? n.shadowRoot
                ? read(n.shadowRoot)
                : read(n)
              : ""
        )
        .join(" ");
    }
    return read(document.body).replace(/\s+/g, " ").trim();
  };
  const text = await internal.evaluate(dump);
  const buttons = await internal.locator("button").allTextContents();
  const client = await browser.newBrowserCDPSession();
  const histograms = await client.send("Browser.getHistograms", { query: "WebNN", delta: false });
  const result = {
    testedAt: new Date().toISOString(),
    browser: "Edge",
    version: browser.version(),
    probe,
    internalText: text,
    buttons,
    histograms
  };
  console.log(JSON.stringify(result));
  await writeFile(
    process.env.TEMP + "/ppdetection-webnn-backend-logged.json",
    JSON.stringify(result, null, 2)
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
