declare global {
  var __PPDETECTION_SCRIPT_URL__: string | undefined;
}

if (typeof document === "object" && document.currentScript instanceof HTMLScriptElement) {
  globalThis.__PPDETECTION_SCRIPT_URL__ = document.currentScript.src;
}

export * from "./index";
