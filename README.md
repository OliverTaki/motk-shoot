# MOTK Shoot — free stop motion studio

MOTK Shoot is a **free, browser-based stop motion animation capture tool** —
a lightweight alternative to Dragonframe for anyone who doesn't need motion
control rigs. The static browser app runs on **any modern desktop OS** (Windows /
macOS / Linux / ChromeOS) with UVC cameras the OS exposes, needs no app installer,
and stores projects locally. Optional RAW tethering uses the bundled Node agent.

Part of the free stop motion tool set at **https://stopmotiondatabase.com/tools**.

**New here? Read the [illustrated User Guide](docs/USER_GUIDE.md)** — a
screenshot walkthrough of shooting, editing, and delivery.

## Features

- **Live view** from UVC/HDMI or agent-streamed gphoto2 PTP previews, with
  adjustable resolution (up to 4K), digital zoom/pan focus check,
  mirror / rotate 180°
- **Onion skinning** — up to 5 ghost frames, opacity slider, blend or difference
  mode, next-frame ghosting in review
- **Capture** with per-shot hold count (shoot on twos/threes), optional hi-res
  photo mode (`ImageCapture.takePhoto`), capture flash, non-overlapping time-lapse
  with optional camera-setting ramps, and bin-only **TEST** shots that never
  enter the take unless inserted manually
- **Non-destructive editing** — every shot lives forever in the captures bin;
  the timeline is an *edit* (a reference list). Undo/redo everything
  (`Ctrl+Z`), keep multiple **alt edits** side by side, and reset any edit to
  **as-shot** (capture order, shot holds) at any time
- **Tactile timeline** — click to review, drag to reorder, **grab a frame's
  right edge and pull to stretch/shrink its hold** (Dragonframe-style),
  right-click for duplicate / hold / insert black / remove / save frame
- **Tether — RAW originals** — a tiny bundled agent (gphoto2 / digiCamControl)
  fires the camera's *own* shutter on every capture: real shutter speed / ISO,
  RAW+JPEG saved to disk, file names tracked per frame (RAW badge + CSV edit
  list for conforming in post), optional camera-JPEG swap-in as the frame
  image — see [`docs/TETHER.md`](docs/TETHER.md), including the optional native
  SIGMA SDK helper for Windows and the advanced WSL2 fallback
- **X-Sheet** — exposure-by-exposure table with per-frame dialogue / phoneme
  notes for lip sync
- **Multi-track audio and lip sync** — WAV/MP3 tracks with independent offset,
  volume and mute, stacked waveform, mixed playback/export, X-Sheet-driven
  generic or custom face sets, and printable/PDF exposure sheets; see
  [`docs/AUDIO_LIPSYNC.md`](docs/AUDIO_LIPSYNC.md)
- **Cinematography monitor** — histogram, clipping zebra, focus peaking, chroma
  key, anamorphic desqueeze, exposure-synced video reference, pen/text guides,
  and onion registration offsets
- **Review** — 0.25–2x range playback, IN/OUT loops, hold-P pop-through, and
  split/full-frame comparison between edits or production takes; see
  [`docs/CINEMATOGRAPHY_REVIEW.md`](docs/CINEMATOGRAPHY_REVIEW.md)
- **Video assist and Observer:** a clean pop-out second display, remappable
  keyboard/WebHID controls, and a read-only LAN preview for phones or tablets;
  see [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md)
- **Exposure passes:** per-project named pass presets (front light, backlight,
  etc.), one-click three-shot shutter bracketing, camera focus-drive buttons,
  grouped originals per frame, and pass badges in the timeline and captures bin
- **Production layer:** the PROD panel pulls pre-named shots from a published
  Google Sheet or user-owned MOTK Apps Script, creates the next take in one
  click, tracks notes and handover, and writes results back
- **Portable shot folders:** the combined camera/production agent mirrors JPEGs,
  preserves tether originals, and writes shot/take metadata, audio, reports, and
  a full session backup under one stable shot folder; see
  [`docs/PRODUCTION.md`](docs/PRODUCTION.md)
- **Optional WebUSB/PTP lab:** an isolated, reproducible browser-camera
  experiment with environment diagnostics and a dedicated local server; it does
  not replace the production tether agent — see
  [`docs/WEBUSB_EXPERIMENT.md`](docs/WEBUSB_EXPERIMENT.md)
- **Playback** — 1–60 fps, loop, short play (last 1.5 s), Dragonframe-style
  keys (`Enter` capture, `1`/`2` step, `3` live toggle, `4` short play, `Space` play)
- **Manual camera controls** where the camera exposes them to the browser:
  focus, shutter, ISO, white balance, zoom, brightness/contrast/saturation/sharpness
- **Composition guides** — thirds / quarters / golden grids, center cross,
  safe areas, aspect masks (2.39, 1.85, 16:9, 4:3, 1:1, 9:16)
- **Export** — MP4/WebM movie (with audio), numbered JPEG sequence as ZIP,
  full project backup/restore as ZIP, plus EDL, FCPXML, AAF-lite, and generated
  ProRes/DNxHR conform recipes; see
  [`docs/EDITORIAL_HANDOFF.md`](docs/EDITORIAL_HANDOFF.md)
- **Projects** — everything autosaves to IndexedDB in your browser; multiple
  projects, rename, delete, import images as frames
- **Edit ops** — reverse sequence, append reversed copy (ping-pong), insert
  black frames
- Installable as a PWA, works offline after first load

## What it deliberately does *not* include

DMX lighting and motion control (Arc/moco) are **out of scope by design**.
Instead, MOTK Shoot broadcasts every event (capture, playback, frame changes…)
over a **WebSocket bridge** and accepts remote commands, so you can bolt on
lighting/rig control externally — see
[`docs/BRIDGE_PROTOCOL.md`](docs/BRIDGE_PROTOCOL.md) and the sample Node relay
in [`bridge/`](bridge/). A `window.motkshoot` JS API is also exposed for
embedding and scripting.

## For developers / AI agents

Start with [AGENTS.md](AGENTS.md) (architecture, invariants, test recipes) and
[docs/DRAGONFRAME_GAP.md](docs/DRAGONFRAME_GAP.md) (feature gap list vs Dragonframe
with priorities).

## Running it

The browser app is a static page — no build and no runtime dependencies.

```sh
cd MOTK Shoot
python -m http.server 8000     # or: npx http-server
# open http://localhost:8000
```

Or deploy the folder to any static host (Cloudflare Pages, GitHub Pages, …).
A camera requires a **secure context**: `http://localhost` or `https://`.

## Cameras

- **Webcams / UVC devices**: work out of the box at their native resolution.
- **DSLR / mirrorless with RAW**: run the bundled tether/production agent
  (`node bridge/production-agent.mjs`) — live view comes from HDMI/USB while every
  capture also fires the real shutter and archives RAW originals
  ([docs/TETHER.md](docs/TETHER.md)).
- **DSLR / mirrorless / phone (live view)**: the standard workflow is an
  **HDMI → USB (UVC) capture device** (widely available for ~$10–20). Your
  camera's clean HDMI output then appears in MOTK Shoot as a normal camera —
  this also gives you the camera's real lens/sensor for live view and capture.
  Set exposure manually on the camera body for flicker-free frames.
- **Phone as camera**: apps like Camo/DroidCam/Iriun expose the phone as a
  webcam, which MOTK Shoot picks up.

Practical shooting tips: lock exposure/white balance (on the camera body or
via the Controls panel), shoot at 1080p or 4K, and turn off any auto-focus.

## Storage notes

Frames are stored as JPEGs in your browser's IndexedDB, per origin. Use
**Export → Backup project** regularly to keep a `.zip` on disk (it re-imports
losslessly). Movie export renders in real time via `MediaRecorder`; for exact
frame-perfect masters, export the image sequence and encode with ffmpeg:

```sh
ffmpeg -framerate 12 -i frame_%05d.jpg -c:v libx264 -pix_fmt yuv420p out.mp4
```

For production shooting, start the same agent with a trusted disk root:

```sh
node bridge/production-agent.mjs --production-root ./productions
```

The browser never chooses an unrestricted filesystem path; all shot folders are
created below that agent root. The browser setup field is descriptive only.

To serve the read-only Observer on a trusted LAN, add
`--host 0.0.0.0 --serve-app`, keep the shooting app connected through
`127.0.0.1`, and open `http://<shooting-computer-ip>:8793/?observer=1` on the
viewing device.

## License

MIT — see [LICENSE](LICENSE). Free forever; if it helps your film, consider
supporting via the donation links at stopmotiondatabase.com/tools.
