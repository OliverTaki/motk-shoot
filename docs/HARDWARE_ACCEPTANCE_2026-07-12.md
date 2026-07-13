# Hardware acceptance - 2026-07-12

This record separates completed software scope from checks that require a
specific connected camera, HID device, display placement, LAN viewer, or editor.
No existing MOTK Shoot project was modified during these checks.

## Environment

| Item | Detected | Acceptance result |
|---|---|---|
| SIGMA fp | Windows WPD, USB VID `1003`, PID `C432` | PASS with SDK sample: connected, live view, Still, 6000x4000 JPEG transfer |
| ELECOM 2MP Webcam | UVC camera | PASS: 1920x1080 live view and one isolated captured frame (`1 / 1`) |
| Displays | Two active monitors (BenQ and LG) | PASS: two displays detected; Chrome opened the clean Video Assist window |
| LAN | `192.168.68.54` | Agent relay was previously verified; another physical phone/tablet remains optional facility verification |
| DaVinci Resolve | 21.0.10011 | Installed; application import/relink check not run in this pass |
| ffmpeg | 6.0 essentials build | PASS: ProRes 422 HQ, DNxHR HQ, and H.264 recipes encoded successfully |
| WebHID keypad | No dedicated keypad identified | Pending the intended physical device |

## ELECOM Windows Hello coexistence

The USB body exposes two logical camera interfaces: `ELECOM 2MP Webcam` for
normal RGB/UVC video and `ELECOM Face Authentication Cam` for Windows Hello.
Both devices and the Windows Hello Face software device report `CM_PROB_NONE`.

MOTK Shoot now filters Face Authentication/Windows Hello interfaces from its
camera list and releases an active UVC stream on page hide, minimization,
navigation, or Windows lock. The deterministic browser self-test passes for
both interface filtering and background release. A user lock-screen recognition
check remains the final confirmation because authentication UI is intentionally
not automated.

## SIGMA fp path

Windows recognizes the body as `SIGMA fp`. The production agent now includes an
optional PowerShell adapter, but does not include the proprietary SDK. Windows
has no native gphoto2 backend.
The documented WSL2 path is not currently ready: `usbipd-win`, WSL gphoto2,
WSL Node, and WSL lsusb are missing.

The user-provided Camera Control SDK ZIP is present. Its sample executable has
a valid Authenticode signature from SIGMA CORPORATION (SHA-256
`D524874088C09282FBFD040D9906B3F215D81E176947D821268EAA5C8E968202`). The
official SDK manual says it supports SIGMA fp firmware 5.00 or later and exposes
camera open/close, view-frame, snap, capture-status, and picture-transfer APIs.
The SDK and documentation must not be redistributed. The adapter loads the
user's licensed ZIP, caches required DLLs below `%LOCALAPPDATA%\MOTKShoot`, and
keeps all SIGMA binaries outside the repository.

After explicit approval, the signed sample connected automatically to the
camera. Live view returned repeated `GetCamViewFrame`
responses and displayed the physical room. Still capture returned `Complete
image create`, 6000x4000 pixels, and 8,058,396 bytes.

The new adapter passes automatic device discovery, SDK initialization, and a
real live-view JPEG transfer. The SDK's preview response included a private
wrapper; the adapter validates and extracts only the complete JPEG payload.

Native still transfer is not yet accepted. The real shutter was exercised only
against an isolated test directory, but the SDK capture-status/file-info path
was not stable enough to mark PASS. No incomplete destination file was left.

### Official sample-program filename warning

The sample wrote to a pre-existing `SDIM0001.JPG`; its creation time remained
unchanged while its modified time and contents changed. This strongly indicates
that the official sample overwrote the same-name file instead of allocating a
collision-safe name.

Do not use the sample's Still action in a Pictures folder containing files that
matter. A MOTK helper must write only to its configured originals directory,
allocate a unique name before transfer, use an atomic temporary file, and refuse
to overwrite any existing path.

## Conform execution

A three-image, five-exposure ffconcat list (holds 2, 1, 2 at 12 fps) was encoded
with the generated command shapes:

| Output | Codec/profile | Frames | Duration |
|---|---|---:|---:|
| `master_prores_422hq.mov` | ProRes HQ | 5 | 0.416667 s |
| `master_dnxhr_hq.mov` | DNxHR HQ | 5 | 0.416667 s |
| `review_h264.mp4` | H.264 High | 5 | 0.416667 s |

This confirms that edit holds and the repeated final concat entry produce the
expected frame count with the installed ffmpeg build.

## Remaining physical acceptance

1. Complete and pass the native SDK still-file transfer; discovery and live view
   already pass without redistributing SIGMA binaries.
2. Connect the intended WebHID keypad and learn one input report.
3. Move Video Assist to the second physical display and visually confirm
   fullscreen framing.
4. Import/relink the generated FCPXML in Resolve and confirm the five-frame test.
