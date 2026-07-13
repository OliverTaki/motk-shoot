# MOTK Shoot — execution roadmap (the map)

**Software roadmap status (2026-07-12): complete — 30/30 items (100%).**
Model-specific camera, HID-device, editorial-system, and facility-network checks
remain documented verification work; they are not missing implementation items.

This is the build plan for reaching **full Dragonframe parity plus the
MOTK-integrated production layer that Dragonframe does not have**. It is
written to be executed phase by phase by an AI agent (Codex) or a human.
Read `AGENTS.md` first (architecture + hard constraints), and
`docs/DRAGONFRAME_GAP.md` for the origin of the numbered gap items (#N).

Rules for executors:

- One phase at a time; land each item working + verified before the next.
- Never violate the AGENTS.md hard constraints (zero deps in the browser app,
  legacy DB name `komadori`, non-destructive captures, no DMX/moco in core).
- The tether/production agent (`bridge/`) is where OS/hardware work lives;
  it may use Node stdlib only. If a task truly needs a native dependency,
  make it an *optional* separate helper, never a requirement for the app.
- Every phase ends with: update `README.md`, `DRAGONFRAME_GAP.md` status,
  and a manual test recipe in `AGENTS.md` if the phase added subsystems.

---

## Phase 1 — Real camera control (PTP) — fp first  [#1 #2 #4 #3 #6 #5 #32]

**Goal:** shoot through the camera's own protocol, not UVC. UVC live view
stays as a fallback; the reference setup for SIGMA fp becomes:

```
fp HDMI (clean out) → cheap HDMI-USB dongle → browser live view
fp USB  (USB Mode: Camera Control) → agent (gphoto2/PTP) → stills, RAW, settings
```

1.1 **Agent: gphoto2 settings passthrough.** Extend `camera-agent.mjs`
    protocol with `tether.config.list` / `tether.config.set` / `tether.config.get`
    (wraps `gphoto2 --list-config / --get-config / --set-config`). App side:
    render returned configs (shutterspeed, iso, f-number, whitebalance,
    imageformat…) as dropdowns in the Tether section. Acceptance: change
    shutter speed from the app, shoot, EXIF shows it.
1.2 **Agent: PTP live view streaming.** `tether.liveview.start/stop` →
    agent runs `gphoto2 --capture-movie --stdout` (MJPEG) or repeated
    `--capture-preview`, pushes JPEG frames as base64 WS messages (~10–15fps).
    App: new camera source "Tether live view" rendered like the video element.
    This removes the HDMI dongle requirement where gphoto2 supports preview.
    Verify per model.
    **Implementation status (2026-07-12):** repeated `--capture-preview --stdout`
    streaming, source selection, capture integration, and clean stop are complete
    and dummy-backend verified. The optional Windows SIGMA SDK adapter also
    passes physical fp discovery and real preview-JPEG transfer; native still
    transfer remains in hardware acceptance.
1.3 **Windows path.** gphoto2 is not native on Windows. The preferred SIGMA fp
    path is the optional native adapter loading the user's licensed SDK ZIP;
    it redistributes no SIGMA binaries. The advanced fallback remains WSL2 +
    usbipd-win USB passthrough running the agent inside WSL
    (`docs/TETHER.md` gets a Windows section with exact commands). Fallback:
    digiCamControl backend (Canon/Nikon/Sony). Long-term experiment (1.6).
    **Implementation status (2026-07-12): complete for software integration.**
    Native discovery and preview pass on the physical fp; still transfer remains
    an explicit hardware-acceptance item. Exact current usbipd-win
    4+/5+ commands, privilege boundaries, cleanup, and troubleshooting are
    documented; `bridge/setup-wsl-tether.ps1` provides safe, explicit actions.
1.4 **Test shots** (#4): "Test" button next to capture — shoots via tether
    (and/or live grab) into the captures bin *without* inserting into the
    edit; bin already displays unused captures.
    **Implementation status (2026-07-11): complete.** TEST captures are marked,
    tether-aware, persisted, backup-safe, excluded from as-shot reconstruction,
    and manually insertable from the bin.
1.5 **Multiple exposures per koma** (#3): per-project list of sub-exposure
    presets (name + config overrides, e.g. front-light/back-light); capture
    loops presets, agent applies config between shots; frame stores
    `raw: 'a.dng;b.dng'` per pass and the app shows pass badges.
    Bracketing (#6) = same mechanism with exposure offsets. Focus drive (#5)
    = `--set-config manualfocusdrive`. Intervalometer ramping (#32) = time-lapse
    loop applies config steps.
    **Implementation status (2026-07-11): complete.** Named per-project presets,
    atomic agent-side pass loops with guaranteed config restoration, grouped
    originals/pass badges, three-shot bracketing, `manualfocusdrive` controls,
    and non-overlapping time-lapse config ramps are dummy-backend and browser
    verified. Physical-camera behavior remains part of the Phase 1 hardware pass.
1.6 **(Experiment) WebUSB/PTP in-browser** ("web-gphoto2"): libgphoto2 in
    WASM over WebUSB — no agent needed on ChromeOS/Linux/Mac; Windows needs
    a WinUSB driver (Zadig). Keep optional; never a core dependency.
    **Experiment status (2026-07-11): complete.** The upstream project was
    archived on 2026-02-09, so it is pinned only inside an isolated lab with
    provenance/license records, capability diagnostics, preview/still controls,
    safe unsupported-environment behavior, and a zero-dependency COOP/COEP
    localhost server. The production agent path and PWA cache remain unchanged.
    WebAssembly/worker initialization and both header/no-header browser flows are verified;
    SIGMA fp hardware behavior remains explicitly experimental.

## Phase 2 — Production layer: shots × spreadsheet × folders  (beyond DF)

**Goal (owner spec):** shots for a whole production are pre-named in a
Google Sheet (MOTK-style: the sheet is the DB, in the user's own account);
MOTK Shoot pulls the shot list, the animator just adds takes; every shot's
data lives complete in ONE local folder; results and notes flow back to the
sheet.

2.1 **Shot/Take data model.** New module `js/production.js`:
    `production = {id, name, sheetRef, root}` (stored in `meta`);
    shot = `{shotId, scene, name, plannedFrames, fps, status, notes, handover}`;
    take = one MOTK Shoot *project* (existing model) tagged
    `{productionId, shotId, take: N}`. Naming: `SC010_C020_T03` — pattern
    configurable per production (`{scene}_{shot}_T{take:2}`) (#21).
    **Implementation status (2026-07-11): complete.** Production metadata,
    validated shot records, project take tags, next-take lookup, configurable
    naming tokens, and backup-safe v5 tags are implemented.
2.2 **Production panel** (new modal or sidebar tab "PROD"): shot list with
    status chips; select shot → "New take" (auto-named project, one click);
    "＋Add shot" inline (owner: adding must be trivial — one row form,
    written back to the sheet on next sync); per-shot notes + 申し送り
    (handover) text areas.
    **Implementation status (2026-07-11): complete.** The PROD sidebar provides
    production setup, status rows, one-row shot creation, one-click take
    creation, shot editing, sync actions, and End session.
2.3 **Sheet sync v1 — no OAuth needed.**
    - *Pull:* the production sheet is shared as CSV (File→Share→publish or
      export URL); app fetches CSV directly (CORS-safe via the agent if
      needed) and merges the shot list.
    - *Push:* app generates `production_report.csv` (+ writes it into the
      shot folder via the agent); MOTK's Apps Script imports it.
    **Implementation status (2026-07-11): complete.** Quoted CSV parsing and
    merge, direct published-CSV pull with a Google-host-only agent fallback,
    canonical report generation, download, and disk mirroring are implemented.
2.4 **Sheet sync v2 — live, via MOTK GAS.** MOTK's Apps Script web app gains
    a `/shoot` endpoint (token in the URL like existing MOTK deployments):
    `GET shots` / `POST take-results` / `POST note`. App talks to it
    directly (fetch, user-owned deployment → no third-party server). Columns:
    `shot_id, scene, name, status, planned_frames, fps, takes, best_take,
    frames, duration_s, raw_count, notes, handover, folder, updated_at`.
    **Implementation status (2026-07-11): complete.** Live GET/POST, a bounded
    retry queue, token-bearing deployment URLs, and a user-owned Apps Script
    reference implementation are complete.
2.5 **Per-shot folder = single source of truth on disk** (#19). The agent
    (rename to `production-agent`; same process as tether) maintains:
    ```
    <root>/<production>/<SHOT_ID>/
      shot.json            (shot meta, takes index, sheet snapshot, notes)
      T01/
        take.json          (fps, holds, edit lists, camera configs used)
        frames/  frame_00001.jpg …  (live mirror of captured JPEGs)
        raw/     kdr_*.dng …        (tether originals)
        audio/   track.wav
        backup.zip                  (full app backup, auto after each session)
    ```
    App→agent messages: `folder.mirrorFrame` (JPEG after each capture),
    `folder.writeMeta`, `folder.backup`. Everything about the shot is inside
    its folder — portable, big-project link is just the sheet row + path.
    **Implementation status (2026-07-11): complete.** The combined agent has a
    preferred `production-agent.mjs` entry point, a fixed trusted root,
    sanitized segments, atomic writes, live JPEG and non-destructive RAW copies,
    metadata/audio/report/backup writes, and previz/plates directories.
2.6 **Auto-reporting.** On "End session" (or every N minutes): write
    take.json + report row (frames, duration, raw count, date) → sheet sync.
    **Implementation status (2026-07-11): complete.** End session writes the
    full local package and live result; configurable periodic runs refresh
    metadata and reports without repeatedly generating large backups.
2.7 **MOTK / MOTK3D / production-tool linkage.** Same sheet workbook can be the
    MOTK production workbook (shots table shared). MOTK3D and other
    MOTK-compatible tools read the same `<SHOT_ID>` folder convention (previz
    renders / plates land in the shot folder under `previz/`, `plates/`).
    Define only the folder + sheet contract here; no closed-source production
    code enters this repo.
    **Implementation status (2026-07-11): complete.**
    `docs/PRODUCTION_CONTRACT.md` defines the shared public identity, columns,
    payloads, ownership boundaries, and portable folder layout only.

## Phase 3 — Cinematography tools (pure browser)  [#8 #9 #10 #11 #12 #13 #14]

3.1 Histogram + clipping warning overlay (#8): compute on the live canvas at
    ~5fps into a small corner canvas; zebra toggle.
    **Implementation status (2026-07-11): complete.** Capped-resolution,
    monitor-only analysis provides a logarithmic live histogram, adjustable
    clipping marker, and striped zebra without modifying captures or exports.
3.2 Video reference layer / rotoscope (#12): layer type `video` — file in
    `assets`, seek to `exposure/fps + offset` on each koma change. The layer
    engine already handles transform/opacity/keys.
    **Implementation status (2026-07-11): complete.** Video assets are stored in
    IndexedDB, seek from exposure plus frame offset, use existing transforms and
    keyframes, and survive typed-asset v6 backups.
3.3 Focus peaking (#9): Sobel edge highlight on the zoomed region.
    **Implementation status (2026-07-11): complete.** Adjustable luminance-edge
    peaking renders green in the monitor analysis pass and follows zoom.
3.4 Chroma key (#10): key color + tolerance on live view, background = any
    `behind` layer.
    **Implementation status (2026-07-11): complete.** Key color/tolerance are
    configurable, and corrected behind-plane ordering reveals reference layers.
3.5 Anamorphic desqueeze (#11): x-scale factor in viewport + export note.
    **Implementation status (2026-07-11): complete.** 1.33/1.5/1.8/2.0x monitor
    desqueeze persists in project settings and backup metadata.
3.6 Freehand pen + text layer types (#13); onion ghost registration offset (#14).
    **Implementation status (2026-07-11): complete.** Persistent pen paths and
    text use layer transforms/keyframes; onion ghosts have independent X/Y
    registration and one-click reset.

## Phase 4 — Audio & lip sync  [#15 #16 #17]

4.1 Multiple audio tracks with per-track offset/volume/mute; mix via
    AudioContext for playback and export.
    **Implementation status (2026-07-11): complete.** Single tracks migrate
    automatically; multiple tracks persist in the legacy store, render stacked
    waveforms, scrub/play together, and mix into exports.
4.2 Face sets (#16): a face set = image collection mapped to phoneme letters;
    X-Sheet note letters drive an auto face-set layer per koma (uses the
    layer engine); ships with a generic mouth chart.
    **Implementation status (2026-07-11): complete.** X-Sheet tokens drive the
    bundled A/E/I/O/U/MBP/FV/L/WQ/rest chart; filename-mapped custom images are
    supported and included as typed v6 assets.
4.3 X-Sheet print/PDF (#17): print stylesheet.
    **Implementation status (2026-07-11): complete.** Print / Save PDF and a
    clean paged stylesheet include project, fps, frame/hold, and notes.

## Phase 5 — Review  [#22 #23 #24]

5.1 Playback speed ×0.25–×2 + in/out range loop (loop the selected koma range).
    **Implementation status (2026-07-11): complete.** 0.25/0.5/1/2x playback,
    persisted exposure IN/OUT points, range looping, audio rate, prefetch, and
    hidden-tab-safe timing are implemented.
5.2 Pop-through (#23): momentary flip live↔selected frame while a key is held.
    **Implementation status (2026-07-11): complete.** Holding P flips the monitor
    without changing selection; release or window blur restores it.
5.3 Take compare (#24): split/AB viewport of two edits or two takes.
    **Implementation status (2026-07-11): complete.** Source B lists other edits
    and tagged takes of the same shot, with split and full-frame A/B modes.

## Phase 6 — Editorial hand-off  [#20 #25 #26]

6.1 EDL / FCPXML / AAF-lite writers from the edit list (plain-text formats).
    **Implementation status (2026-07-12): complete.** The Export pane generates
    CMX3600 EDL, FCPXML 1.10, portable AAF-lite JSON, and an authoritative
    editorial manifest from the active edit, including holds, capture/RAW
    mapping, notes, audio placement, and desqueeze metadata.
6.2 Documented ffmpeg conform recipes (ProRes/DNx masters from mirrored
    frames or RAW) generated per shot into the shot folder (#25 #26).
    **Implementation status (2026-07-12): complete.** A hold-aware ffconcat
    list plus ProRes 422 HQ, DNxHR HQ, and H.264 recipes can be downloaded or
    atomically written as a six-file hand-off package on End session. RAW
    originals and backups remain untouched.

## Phase 7 — Ecosystem  [#7 #29 #30]

7.1 Pop-out clean live view window for a second monitor / video assist (#7).
    **Implementation status (2026-07-12): complete.** MONITOR opens a
    same-origin, fullscreen-capable, chrome-free renderer that follows the
    composited shooting viewport without opening a second camera stream.
7.2 Remappable shortcuts + WebHID keypads (#29).
    **Implementation status (2026-07-12): complete.** All shooting/review
    actions have persisted keyboard mappings, collision rejection, defaults,
    and optional input-only WebHID report learning for macro pads.
7.3 Observer mode (#30): read-only URL flag; the agent can serve the app on
    LAN so a phone/tablet can watch progress live.
    **Implementation status (2026-07-12): complete.** `?observer=1` boots only
    a read-only preview client. The zero-dependency agent can serve allowlisted
    app assets and relay capped previews while rejecting all non-loopback
    capture, camera, folder, and publish commands.

---

## Verification quick-recipes

- No camera: inject synthetic frames (snippet in AGENTS.md), dummy agent
  `node bridge/camera-agent.mjs --backend dummy`.
- Sheet sync v1: any published-CSV Google Sheet.
- PTP work needs real hardware (owner has SIGMA fp — USB Mode
  **Camera Control**, not UVC, when testing gphoto2; UVC mode is only for
  webcam-style live view and cannot shoot stills).
