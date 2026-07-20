# MOTK Shoot Local

MOTK Shoot Local is the focused Windows edition of MOTK Shoot. It is a stop-motion studio, not a one-click still-camera utility.

## Product boundary

The local edition keeps the complete shooting loop:

- live view and camera selection;
- camera controls and tethered capture when MOTK Companion is available;
- TEST captures;
- immutable captured frames and recovery storage;
- timeline ordering, holds, duplicate, reverse, ping-pong, remove and undo;
- frame stepping, scrubbing, loop, short play and normal playback;
- onion skin, guides, layers, monitor, audio and X-Sheet;
- projects, a user-selected local capture folder, backup, movie and image-sequence export.

It intentionally removes production administration and post-production hand-off from its normal interface: MOTK Core/Google Sheets, PROD, Review/A-B comparison, external bridge, After Effects, Resolve, Autograph, Media Tools and conform are not part of this focused edition.

The local edition and the web edition share the same capture/timeline/playback core. The focus is applied by the `edition=local` shell, so bug fixes to the core do not have to be recreated in a fork.

## Start on Windows

1. Extract the ZIP.
2. Keep `_internal` next to `MOTK Shoot Local.exe`.
3. Double-click `MOTK Shoot Local.exe`.
4. Choose the camera in **Settings > Camera**, then start live view.
5. In **Files > Storage**, choose a **Local capture folder** before an important shoot.

The launcher serves the application only on `127.0.0.1`. It opens a dedicated Edge application window and a dedicated browser profile. That fixed local origin preserves IndexedDB recovery projects between launches. The local server closes after the app window stops sending its private heartbeat.

## Where frames are stored

Every accepted capture first enters MOTK Shoot's IndexedDB recovery store. A selected local capture folder adds a visible disk mirror and does not replace recovery storage. Project ZIP backup is the portable archive. Tethered camera originals remain immutable on disk; edit operations change timeline references rather than renaming or overwriting originals.

Stopping/restarting the camera or reloading the current window does not create a new project. By default, closing the application and opening it for a later shoot starts a clean project; previous shoots stay stored and can be opened explicitly. **Settings > Project** can change this to reopen the last project instead.

## Camera boundary

Browser/UVC cameras work without Companion. Vendor SDK control and camera-owned RAW/JPEG capture require MOTK Companion. Companion is optional infrastructure: it can be installed once and paired, but its setup and post-production modules are not exposed inside the focused local UI.
