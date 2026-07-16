# Tether — RAW originals from the real camera

The browser can show a camera's live view, but it **cannot** set shutter speed
or save RAW. The tether agent fixes that: a tiny Node script that runs next to
your camera, fires the **real shutter** on every MOTK Shoot capture, and keeps
the RAW/JPEG originals on disk.

```
[MOTK Shoot (browser)] ←WebSocket→ [camera-agent.mjs] ←USB→ [camera]
        live view grab                  SIGMA SDK / gphoto2 / digiCamControl
        drives the timeline             writes RAW+JPEG to a folder
```

Every frame in MOTK Shoot remembers which original file(s) belong to it — shown
as a green **RAW** badge, exported in the project backup, and available as a
CSV (`Export → Edit list (CSV)`) so you can conform the RAW sequence in
DaVinci/AE later with real shutter-speed exposures.

## Exposure passes, bracketing, and focus

The Camera pane can store named exposure-pass presets per project. Each preset
contains only the camera settings it overrides; settings omitted by a preset
stay at their current values. On capture, the agent runs the entire pass list
as one camera transaction, groups every downloaded file on the frame, then
restores every touched setting even when a pass fails. The first available
camera JPEG becomes the editable frame image.

**3-shot bracket** creates three shutter-speed passes around the current value.
The Focus drive buttons use the camera's `manualfocusdrive` config when gphoto2
exposes it. Time-lapse can ramp any choice-based camera config over a selected
shot count; its completion-driven timer never starts a new capture while the
previous pass sequence is still running.

## Which USB mode? (important)

A stills camera exposes **either** webcam video **or** camera control on USB —
never both at once:

- **UVC / webcam / video-class mode** → live view only. You can see, but the
  app can only grab the video stream; no real shutter, no RAW.
- **Camera Control (PTP) mode** → the tether agent can fire the shutter, set
  exposure, and download RAW — but no UVC live view on the same cable.

The reference rig is therefore:

```
camera HDMI (clean out) → HDMI→USB dongle → MOTK Shoot live view
camera USB (Camera Control mode) → camera-agent → stills / RAW / settings
```

### SIGMA fp

Set **メニュー → システム → USBモード → カメラコントロール** (Camera Control)
and connect USB. On Windows, the preferred path is the optional native SIGMA
SDK backend below. It uses the user's licensed SDK ZIP and does not redistribute
SIGMA binaries. HDMI/UVC remains the fastest continuous live-view path.

## Setup

Requires Node 18+ (`node --version`).

### macOS / Linux — gphoto2 (2000+ camera models)

```sh
brew install gphoto2          # macOS
sudo apt install gphoto2      # Debian/Ubuntu
node bridge/camera-agent.mjs --dir ~/shoots/scene01
```

Set the camera to **RAW+JPEG** to get both files per shot. Exposure (shutter
speed, ISO, aperture) is whatever the camera body is set to; you can also
pre-set it via gphoto2, e.g. `gphoto2 --set-config shutterspeed=1/4`.

### Windows + SIGMA fp: native licensed SDK

Download `CameraControlSDK_for_Win.zip` from SIGMA and accept its license. Keep
the ZIP outside this repository, then run from the MOTK Shoot folder:

```powershell
node bridge\production-agent.mjs --backend sigma `
  --sigma-sdk-zip "C:\path\to\CameraControlSDK_for_Win.zip" `
  --dir "C:\shoots\scene01"
```

The Windows helper automatically discovers a connected fp without saving its
serial, extracts only the required DLLs from that ZIP into the user's local
`%LOCALAPPDATA%\MOTKShoot` cache, and refuses to overwrite a destination. No
SIGMA binary is stored in this repository.

Physical fp acceptance currently passes discovery, SDK open/close, and real
live-view JPEG transfer. Native still-file transfer is not yet marked PASS; see
`HARDWARE_ACCEPTANCE_2026-07-12.md`. Until it passes, do not treat this backend
as the only copy of an original.

### Advanced Windows fallback: WSL2 and usbipd-win

Requirements: Windows 10 version 2004+ or Windows 11, WSL2, and
[usbipd-win](https://github.com/dorssel/usbipd-win). Microsoft documents the
current USB workflow in
[Connect USB devices](https://learn.microsoft.com/windows/wsl/connect-usb).
usbipd-win 4+ uses `usbipd attach --wsl`; older examples using
`usbipd wsl attach` are obsolete.

The helper defaults to a read-only check:

```powershell
.\bridge\setup-wsl-tether.ps1
```

#### 1. Install the host prerequisites once

Open **PowerShell as administrator**:

```powershell
wsl --install -d Ubuntu
wsl --update
winget install --interactive --exact dorssel.usbipd-win
```

Restart Windows if requested. If `winget` is unavailable, install the current
usbipd-win MSI from its
[official releases](https://github.com/dorssel/usbipd-win/releases). The helper
can run the same host commands with `-Action InstallHost`, but only from an
elevated window.

#### 2. Install the Linux-side tools

From a normal PowerShell window in the MOTK Shoot folder:

```powershell
.\bridge\setup-wsl-tether.ps1 -Action PrepareWsl
.\bridge\setup-wsl-tether.ps1 -Action Check
```

This installs `gphoto2`, `nodejs`, and `usbutils` in Ubuntu. Node 18+ is
required. The helper stops with a clear error if an older Ubuntu release
provides an older Node; update that distribution or install a current Node
release inside WSL before continuing.

#### 3. Share the camera once

Set the fp to **USB Mode: Camera Control**, plug it in, then list devices:

```powershell
.\bridge\setup-wsl-tether.ps1 -Action List
```

Copy the camera's BUSID (for example `4-4`). Do not guess it. Open an elevated
PowerShell window for the one-time persistent bind:

```powershell
.\bridge\setup-wsl-tether.ps1 -Action Bind -BusId 4-4
```

#### 4. Attach for each shooting session

Back in a normal PowerShell window:

```powershell
.\bridge\setup-wsl-tether.ps1 -Action Attach -BusId 4-4
```

While attached, Windows cannot use the camera; it belongs to WSL2. Attachment
ends when the camera is unplugged, WSL restarts, or you detach it. The initial
bind remains shared across restarts.

Verify the camera inside WSL and start the agent:

```powershell
wsl -d Ubuntu -- gphoto2 --auto-detect
.\bridge\setup-wsl-tether.ps1 -Action RunAgent -OutputDir ~/motk-shoot-originals
```

Leave that window open. In MOTK Shoot, connect to `ws://localhost:8793`, then
choose **Tether live view (PTP)** or keep an HDMI/UVC source for live view.

When finished, stop the agent with Ctrl+C and return the camera to Windows:

```powershell
.\bridge\setup-wsl-tether.ps1 -Action Detach -BusId 4-4
```

If `lsusb` sees the camera but gphoto2 does not, detach it, rerun
`-Action PrepareWsl` so the package's udev rules are installed, then attach it
again. Never bind an unidentified BUSID.

### Windows fallback: digiCamControl (Canon/Nikon/Sony)

1. Install [digiCamControl](https://digicamcontrol.com/) (free, open source).
2. Run:

```powershell
node bridge\camera-agent.mjs --dir C:\shoots\scene01
# custom install path:
node bridge\camera-agent.mjs --digicam "D:\apps\digiCamControl\CameraControlCmd.exe"
```

### Test without a camera

```sh
node bridge/camera-agent.mjs --backend dummy
```

When using MOTK Companion, copy the pairing key shown once at Companion startup
into **Camera > Tether > Pairing key**, then connect. The key is held only in
the current browser tab (`sessionStorage`), is never added to the saved Agent
URL, and is not written into the MOTK Shoot project or backup. **Forget key**
disconnects and removes it immediately.

When MOTK Shoot is opened from an HTTPS host such as Cloudflare Pages, the
browser asks once for **Local network access** before it permits a direct
connection to `ws://127.0.0.1:8793`. Choose **Allow**. Media and camera traffic
then stays directly between the browser and Companion on this PC; Cloudflare is
not used as a media relay. If permission was denied, re-enable Local network
access for the MOTK Shoot site in the browser's site settings.

Writes fake `.jpg`/`.raw` files so you can verify the whole pipeline.

## In MOTK Shoot

Camera tab → **Tether — RAW originals** → Connect (`ws://localhost:8793`).

- **Fire camera shutter on capture** — every `Enter` shoots the real camera too.
- **Use camera JPEG as frame image** — the returned camera JPEG replaces the
  live-view grab in the timeline (full sensor quality in your animation, not
  just the HDMI/webcam stream).

- **Camera settings:** with the gphoto2 backend, the Tether section lists the
  camera's shutter speed, ISO, aperture, white balance, image format, and other
  supported capture controls. Changing a menu applies it through PTP before
  the next shot. The dummy backend exposes test menus; digiCamControl capture
  remains available but does not yet expose settings through this protocol.
- **TEST shot:** the TEST transport button fires the same live/tether capture
  path but saves a marked, immutable bin capture without changing the edit.
  Test shots retain RAW names, survive backup/restore, and stay out of as-shot
  reconstruction unless explicitly inserted from the bin.

The status line shows the folder where originals land. Companion uses the
visible `Camera Originals` folder below its selected FILES root. File names are
`kdr_YYYYMMDD_HHMMSS_nnnn.<ext>`.

## PTP live view

With the SIGMA, gphoto2, or dummy backend connected, choose **Tether live view (PTP)**
from Camera > Source. The agent repeatedly requests camera preview JPEGs and
streams them to the browser (up to 15 fps); the viewport, onion skin, guides,
and normal capture flow then use that preview exactly like a UVC source.

The agent serializes preview, settings, and shutter commands so the camera is
never asked to perform overlapping PTP operations. If decoding falls behind,
the browser drops stale preview frames rather than building latency. Stop or
switch camera sources to send `tether.liveview.stop` and release the preview.

Camera support varies. Verify `gphoto2 --capture-preview --stdout` with a
gphoto2 body. SIGMA fp preview has been confirmed with the native SDK backend;
UVC/HDMI remains the fallback when a body cannot provide PTP previews fast enough.

## Notes

- The live-view grab still happens instantly, but a tethered frame enters the
  timeline only after the camera reports that its files are on disk.
- If the physical shutter or disk write fails, MOTK Shoot shows the camera
  error, removes the provisional browser grab, and does not advance the frame
  counter. A visible frame therefore means the configured capture transaction
  completed.
- Agent options: `--port 8793 --dir ./originals --backend auto|sigma|gphoto2|digicam|dummy`.
- SIGMA options: `--sigma-sdk-zip <licensed ZIP> [--sigma-serial SERIAL]`.
- Localhost and the agent-served Observer are accepted browser origins. For a
  separately hosted app, add one explicit trusted origin with
  `--allow-origin https://shoot.example.org`.
- Windows WSL helper actions:
  `Check|InstallHost|List|Bind|Attach|Detach|PrepareWsl|RunAgent`.
