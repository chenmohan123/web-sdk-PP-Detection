# Deployment

[中文](../zh-CN/deployment.md)

Deploy the SDK and Demo over HTTPS (localhost is exempt). The manifest, ONNX files, ONNX Runtime WASM assets, and Worker need correct MIME types and CORS. A cross-origin model host must return an `Access-Control-Allow-Origin` value that permits the page origin.

Models are large assets. Recommended policy:

- Use immutable version URLs, never `latest`.
- Give hash-addressed ONNX files long immutable caching; use controlled short caching or a versioned URL for manifests.
- Preserve `Content-Length` so download progress is accurate.
- Allow IndexedDB. The SDK can run when it is unavailable, but may download again.
- Before mobile-network downloads, show the actual byte size declared by the manifest; the
  default PicoDet manifest is stable and declares an actual 23,243,834-byte release asset.

Model distribution supports Git LFS, Hugging Face (the Demo default), and ModelScope. Every source must use an immutable revision, versioned path, real `Content-Length`, and SHA-256; an explicit source failure must not silently switch sources, while `auto` may try sources in manifest order. Verify source and integrity metadata before deploying a custom model.

Multithreaded WASM requires:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Before enabling COOP/COEP, check third-party iframes, analytics, and images for CORP/CORS compatibility. Use single-thread WASM when isolation is unavailable instead of breaking authentication or embedding.

For WeChat, deploy an HTTPS H5 page for an Official Account or a mini-program `web-view`, and configure the business domain. It does not support native mini-program inference. GPU capabilities vary across iOS and Android WebViews, so rely on probing and WASM fallback.

Document images stay in browser inference and are not sent to this project's servers. Application owners must still audit their own analytics, logging, and error reporting so document images and unsanitized results are not captured.
