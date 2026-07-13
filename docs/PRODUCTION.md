# Production workflow

MOTK Shoot can manage every shot and take for one production while keeping the
Google Sheet in the owner's account and all media on local storage.

## Start

1. Run `node bridge/production-agent.mjs --backend dummy` for testing, or choose
   the SIGMA SDK, gphoto2, or digiCamControl backend. Add
   `--production-root "D:\Productions"` to select the disk root.
2. Serve and open MOTK Shoot, connect the local agent in **CAM**, then open
   **PROD**.
3. Create a production. Save its name, take naming pattern, optional descriptive
   root, published CSV URL, optional GAS URL, and report interval.
4. Pull a published CSV or add a shot with the single-row form.
5. Select the shot and press **New take**. The new project inherits the shot fps
   and is tagged automatically.
6. Capture normally. JPEG mirrors and tether originals flow into the take
   folder without removing browser captures or camera originals.
7. Update status, notes, and handover; press **End session**. This writes
   metadata, audio, report CSV, full backup, and the live GAS result when set.

The root field in the browser is descriptive and appears in production setup;
the trusted filesystem root is the agent's `--production-root` argument.

## Published CSV

Publish the `Shots` sheet as CSV or use a Google export URL, paste it into
**Published CSV URL**, and press **Pull CSV**. Direct browser fetch is attempted
first. If the Sheet blocks cross-origin access, the connected local agent can
fetch only allow-listed Google HTTPS hosts.

## Live Apps Script

Copy `bridge/motk-gas-shoot.gs` into a script bound to the workbook, set Script
Property `MOTK_SHOOT_TOKEN`, deploy as a Web app, and paste the `/exec?token=...`
URL into **MOTK GAS URL**. Existing MOTK scripts can route requests to
`shootDoGet(e)` and `shootDoPost(e)` instead of using the supplied wrappers.

The exact columns, payloads, retry behavior, and cross-tool disk structure are
defined in `docs/PRODUCTION_CONTRACT.md`.

## Browser origin protection

The agent rejects browser WebSocket connections from unrelated web origins.
Localhost and an Observer served by the agent are allowed automatically. If the
shooting app is intentionally hosted elsewhere, allow exactly that origin, for
example `--allow-origin https://shoot.example.org`.
