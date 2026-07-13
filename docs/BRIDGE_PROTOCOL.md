# MOTK Shoot bridge protocol (v2)

MOTK Shoot keeps DMX / motion control out of the core app. Instead it speaks a
tiny JSON-over-WebSocket protocol so external controllers (lighting boards,
Arduino/ESP rigs, moco software, custom scripts) can synchronize with capture.

## Topology

MOTK Shoot is a **WebSocket client**. You run a small server (your rig
controller, or the sample relay in `bridge/server.mjs`), and point
MOTK Shoot's **LINK** panel at it (default `ws://localhost:8790`).

```
[lighting rig / moco / scripts] ←→ [your WS server] ←→ [MOTK Shoot (browser)]
```

## Messages from MOTK Shoot

On connect:

```json
{ "type": "hello", "app": "MOTK Shoot", "version": 1, "state": { … } }
```

Then one message per app event:

```json
{ "type": "event", "event": "frame:captured", "data": { "id": "f_…", "index": 41, "hold": 2 } }
```

Forwarded events:

| event | when |
|---|---|
| `frame:captured` | a frame was shot (fire your lights *before* via `capture` round-trip, or use this to advance a rig *after*) |
| `test:captured` | a test shot entered the bin; it did not change the edit and must not advance a rig |
| `frames:changed` | sequence edited (add/remove/move/hold) |
| `captures:changed` | the immutable captures bin changed without an edit change |
| `playback:started` / `playback:stopped` | preview playback |
| `playback:frame` | every exposure during playback (`{exposure, frame}`) |
| `mode:changed` | live ↔ review |
| `camera:started` / `camera:stopped` | capture stream state |
| `project:opened` | project switched |
| `audio:loaded` | audio track loaded |

## Commands to MOTK Shoot

Send a JSON object with `cmd` (and optional `id` for correlating the reply):

| cmd | payload | effect |
|---|---|---|
| `capture` | — | shoot a frame |
| `testCapture` | — | shoot into the captures bin without changing the edit |
| `play` | `{"opts": {"short": true}}` | start playback |
| `stop` | — | stop playback |
| `live` | — | return to live view |
| `goto` | `{"frame": 12}` | review frame 12 (0-based) |
| `deleteLast` | — | delete the last frame |
| `state` | — | reply with current state |
| `setOnion` | `{"opts": {"on": true, "frames": 2, "alpha": 0.4}}` | configure onion skin |

Every command gets a reply:

```json
{ "type": "reply", "id": "<your id>", "ok": true, "frames": 42 }
```

## Typical DMX/moco integration

1. Your controller receives `capture` requests from a hardware button or its own UI.
2. It sets lights via DMX, waits for them to settle, then sends `{"cmd":"capture"}` to MOTK Shoot.
3. On the `frame:captured` event it advances the motion-control rig to the next position.

## JS API (same machine, no socket)

Everything is also on `window.motkshoot` when the page is embedded or scripted:

```js
motkshoot.capture();
motkshoot.testCapture();
motkshoot.goToFrame(10);
motkshoot.state();                    // → {project, frames, captures, exposures, mode, …}
motkshoot.on('frame:captured', d => console.log(d));
```

## Camera/production agent messages

`bridge/production-agent.mjs` is a separate WebSocket server (default port
8793) used by the CAM and PROD panels. It is the same zero-dependency process as
the legacy `camera-agent.mjs` entry point. Every request has an `id`; every
response is `{"type":"tether.result","id":"...","ok":true}` or contains an
`error`. Production requests include this context:

```json
{
  "productionId": "prod_...",
  "production": "Feature A",
  "shotId": "SC010_C020",
  "take": 3,
  "projectId": "p_..."
}
```

| request | payload beyond `context` | effect |
|---|---|---|
| `folder.mirrorFrame` | `frame`, `captureId`, base64 `data` | atomically writes the next mirrored JPEG |
| `folder.writeMeta` | `shot`, `takeMeta` | writes `shot.json` and `take.json` |
| `folder.audio` | `name`, base64 `data` | writes the take audio track |
| `folder.backup` | base64 `data` | writes the full `backup.zip` |
| `folder.report` | `csv` | writes the production report at production and shot level |
| `folder.editorial` | fixed-name text `files` object | atomically writes the six editorial/conform files into the take folder |
| `sheet.fetch` | `url` | CORS fallback restricted to Google HTTPS hosts, 5 MB maximum |

### Observer relay

With `--serve-app`, the same agent serves the allowlisted browser assets. A LAN
viewer opens `/?observer=1` and sends `observer.subscribe`; the local shooting
app sends `observer.publish` with a JPEG preview (5 MB maximum) and bounded
state. Subscribers receive `observer.update`. Connections whose remote address
is not loopback may only subscribe; every capture, camera, folder, sheet, config,
and publish request receives a read-only error.

The agent's CLI `--production-root` is the only trusted filesystem root. All
context values are sanitized into single path segments, binary payloads have
size limits, editorial files use a fixed allowlist with per-file/package size
limits, and tether originals are copied rather than moved. The complete
cross-tool contract is in `docs/PRODUCTION_CONTRACT.md`.
