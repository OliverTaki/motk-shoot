# MOTK Shoot — free stop-motion capture studio

MOTK Shoot is a free browser-based camera-room tool for stop-motion animation.
It runs on phones, tablets, and desktop computers with no app installer. The
desktop workspace stays spacious; narrow screens automatically receive a
touch-first shooting layout.

**Open the web app:** https://motk-public-site.pages.dev/apps/shoot/

**New here?** Read the [illustrated User Guide](docs/USER_GUIDE.md).

## MOTK Shoot Local

The Windows local edition keeps the full stop-motion shooting loop—capture, TEST, timeline editing, holds, playback, onion skin, guides, layers, audio/X-Sheet, local mirror and export—without showing production administration or post-production hand-off tools. See [docs/LOCAL_EDITION.md](docs/LOCAL_EDITION.md). Build it with `powershell -ExecutionPolicy Bypass -File local-app/build-windows.ps1`.

## One job: shooting

MOTK Shoot is deliberately centred on the work done beside the set:

- connect a camera and capture frames or disposable tests;
- use onion skin, composition guides, monitor aids, shooting layers, audio,
  and X-Sheet cues;
- check the last pose, step through the take, or play a short range;
- receive a prepared shot list as CSV or JSON and open the next take;
- record shooting notes, handover notes, and a session result;
- keep browser recovery storage, mirror JPEGs to a chosen local folder on
  compatible desktop browsers, or share/save a session backup on iPhone/iPad;
- start an After Effects project from previs before photography, publish each
  photographed pass as a versioned delivery, and load returned comps as
  non-destructive shooting references;
- use **Focus mode** for a clean full-screen camera view with Capture and
  Play/Pause, then hide even those controls with one tap.

It is not a production-planning or picture-editing application. MOTK, a
spreadsheet, or another production tool prepares the shot context; MOTK Shoot
receives it. Editorial comparison, alternate cuts, and delivery-package tools
remain readable for older projects but are no longer part of the normal
shooting interface.

MOTK Shoot does **not** contain MEGATOOLS or MegaProd code.

## Cameras

- **Webcam / UVC / HDMI-USB capture:** works directly in the browser.
- **Phone camera:** open the web app on the phone, allow camera access, then use
  the always-visible **CAM** button to switch front/back/lens sources without
  opening the full Settings panel. The touch layout and Focus mode work in
  portrait and landscape.
- **DSLR / mirrorless RAW and vendor controls:** use the optional local
  Companion/tether agent. See [Tether and camera control](docs/TETHER.md).
- **SIGMA, Nikon, Canon, and Sony:** support depends on the selected browser
  input, vendor SDK, or local camera backend. The browser remains the shooting
  surface; the Companion handles privileged hardware and disk access.

A camera requires HTTPS or `http://localhost`. Only one app can own a camera at
a time.

## Storage

Every capture first goes to project-scoped IndexedDB in the browser. This is the
recovery copy and works on desktop and mobile.

By default, opening MOTK Shoot after the browser session closes starts a new,
empty shoot. A normal reload and Camera Stop/Restart keep the current project.
Under **Settings → Project → When MOTK Shoot opens**, an operator who prefers a
continuous device can choose **Reopen the last project on this device**. Older
captures never appear automatically under the default: open **Projects** and
choose **Open project** when you deliberately want them.

**Settings → Project → Capture storage** explains the active storage state in
one place. IndexedDB inside this browser profile is always the primary local
recovery copy. It is local, but not a normal Files folder; clearing this site's
browser data removes it.

Under **Session → Save**:

- Chrome/Edge-compatible desktop browsers can choose a folder. Each new JPEG is
  mirrored into `<chosen folder>/<project>/frames` (tests go to `tests`).
- iPhone and iPad do not expose a persistent browser folder picker. Use
  **Save / Share backup** to send the session backup to Files, AirDrop, or
  another share destination.
- The optional Companion can maintain production roots, RAW originals, and
  vendor-camera files when a normal browser is not allowed to do so. Camera
  files are visible under `<FILES root>/Camera Originals`.

Files are never silently overwritten. Disconnecting a folder stops the mirror;
the browser recovery copy remains.

The same Save panel contains a compact **After Effects round-trip**. It supports
previs-first, photography-first, and an independently prepared AE project. A
chosen shared/NAS folder enables versioned `initial_####`, `delivery_####`, and
`return_####` exchange; ZIP plus manual return import works without persistent
folder access. The compositor-owned `.aep`, source stills, RAW originals, and
older returns are never replaced. See
[After Effects round-trip](docs/AFTER_EFFECTS_ROUNDTRIP.md).

The same panel includes separately bounded **DaVinci Resolve** and **Maxon
Autograph** adapters. Resolve packages include FCPXML, OTIO, relative media, and
a documented-API import helper. Autograph packages include relative materials,
an import list, a neutral shot template, and—when the user selects one—an
unchanged studio `.agp` template. Both accept previs-first or photography-first
work and load returned renders only as guide layers. See
[Resolve round-trip](docs/RESOLVE_ROUNDTRIP.md) and
[Autograph round-trip](docs/AUTOGRAPH_ROUNDTRIP.md).

When the physical shutter is enabled, a browser grab remains provisional until
Companion confirms the camera file is on disk. Failed shutter or storage writes
do not advance the frame counter or leave a false frame in the project.

## Shooting features

- Live view, zoom/pan focus check, mirror/rotation, and manual controls exposed
  by the camera.
- Capture holds (twos/threes), TEST frames, high-resolution browser capture,
  time-lapse, lighting passes, bracketing, and focus drive where available.
- Onion skin with previous/next ghosts, blend/difference modes, opacity, and
  registration offsets.
- Composition grids, aspect masks, safe areas, image/video reference layers,
  annotations, histogram, zebra, focus peaking, chroma key, and anamorphic
  desqueeze.
- Multi-track audio, waveform, frame stepping, and X-Sheet dialogue/phoneme
  cues. See [Audio and lip sync](docs/AUDIO_LIPSYNC.md).
- A tactile koma timeline, capture bin, immediate undo, short playback, loop,
  and keyboard/WebHID controls.
- Desktop keeps the full transport visible. Phones keep Capture, Live,
  Play/Pause, stepping, and **•••** within reach; **•••** opens a labelled modal
  for test shots, exposure hold, loop, short play, undo/redo, and the captures
  bin. Portrait and landscape shooting are both supported.
- Video-assist output, Observer, WebSocket bridge, and scripting API. See
  [Ecosystem](docs/ECOSYSTEM.md) and [Bridge protocol](docs/BRIDGE_PROTOCOL.md).
- Offline-ready installable PWA after the first load.

## Receive shot context

Open **Session → Context** and import CSV or JSON from MOTK, a spreadsheet, or
another planning tool. A context may include production name, shot ID/name,
frame target, and notes. Select the shot and open the next take. MOTK Shoot does
not require GAS and does not create or redesign the production.

A context URL can also be refreshed when it serves CSV or JSON with browser
access enabled. Existing project data and older production records remain
compatible.

## Run locally

The application is a static site with no build step or runtime dependencies.

```sh
python -m http.server 8000
# open http://localhost:8000
```

Or deploy the folder to any HTTPS static host.

For optional RAW/tether control:

```sh
node bridge/production-agent.mjs --production-root ./productions
```

The browser cannot choose an unrestricted filesystem path. Privileged disk and
vendor-camera operations stay in the local Companion/agent.

## Product boundaries

- **MOTK Shoot:** capture, on-set assists, immediate review, notes, and session
  handoff.
- **MOTK:** projects, schedules, shared records, and production management.
- **Companion/tether agent:** vendor camera SDKs, RAW files, trusted local
  folders, and external hardware bridges.
- **MEGATOOLS:** separate tools and separate codebase.

See [Product design decision, 2026-07-16](docs/PRODUCT_DESIGN_2026-07-16.md).

## Developers

Start with [AGENTS.md](AGENTS.md) for architecture, invariants, and test recipes.
The isolated [WebUSB/PTP experiment](docs/WEBUSB_EXPERIMENT.md) does not replace
the production tether agent.

## License

MIT — see [LICENSE](LICENSE). Free forever; if it helps your film, consider
supporting the project through Stop Motion Database.
