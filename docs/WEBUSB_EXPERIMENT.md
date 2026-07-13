# Phase 1.6 — optional WebUSB/PTP experiment

This lab tests whether a supported still camera can be controlled directly by
a Chromium browser through WebUSB and libgphoto2 WebAssembly. It is deliberately
separate from MOTK Shoot projects. The camera agent remains the supported path.

## Run the lab

From the MOTK Shoot directory:

```sh
node bridge/serve-webusb-experiment.mjs
```

Open `http://127.0.0.1:8146/experiments/webusb/` in Chrome or Edge. All four
environment checks must be green before **Choose PTP camera** is enabled.

1. Put the camera in PTP / Camera Control mode.
2. Close gphoto2, digiCamControl, photo importers, and any other camera owner.
3. Choose the camera and connect.
4. Read supported operations and settings before attempting a preview.
5. Treat a full-image capture as an experiment, never as the only copy of a take.

The helper is a zero-dependency, localhost-only static server. It adds:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

These headers are required for the archived threaded WebAssembly build's
`SharedArrayBuffer`. A normal static server intentionally fails the lab's
environment check instead of attempting a broken connection.

## Windows

Windows normally binds cameras to its portable-device driver, which WebUSB
cannot claim. A WinUSB association (commonly installed with Zadig) may be
required. Changing that driver can stop Windows camera applications from seeing
the camera until the original driver is restored. For production, use the
documented WSL2/usbipd-win tether-agent path instead.

## What is pinned here

`experiments/webusb/vendor/web-gphoto2/` contains `web-gphoto2` 0.4.1, its
license, and generated runtime files. The npm integrity value and provenance
are recorded in its `NOTICE.md`. The package uses a custom libgphoto2 fork,
libusb's WebUSB backend, Emscripten, and WebAssembly.

Upstream was archived read-only on 2026-02-09. It requires cross-origin
isolation and has no current maintainer guarantee. Therefore Phase 1.6's result
is an isolated, reproducible feasibility lab—not a replacement camera backend.

Primary references:

- WebUSB specification: https://wicg.github.io/webusb/
- Web-gPhoto2 source/archive: https://github.com/GoogleChromeLabs/web-gphoto2
- libgphoto2 source: https://github.com/gphoto/libgphoto2
- Chrome WebUSB/WinUSB guidance: https://developer.chrome.com/docs/capabilities/build-for-webusb

## Verification without a camera

- A normal static server shows WebUSB availability but fails cross-origin
  isolation and keeps all camera buttons disabled.
- The experiment server makes all four checks green.
- Add `?selftest=1` to initialize the pinned WebAssembly/worker runtime without
  displaying a USB permission prompt. The status must say the runtime initialized.
- The server must return `application/wasm` for `libapi.wasm`.

Hardware verification still requires the target camera. For the SIGMA fp,
record browser/OS/driver details, supported operations, preview behavior, still
capture behavior, and whether restoring the normal driver is necessary.
