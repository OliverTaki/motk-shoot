# MOTK production contract v1

This is the public boundary shared by MOTK Shoot, a user-owned MOTK Google
workbook, and other MOTK-compatible production tools. It defines data and
folders only. No private, closed-source production tooling is part of this
repository.

## Identity and ownership

- `shot_id` is the stable cross-tool key. It is 1-64 characters and uses only
  letters, digits, dot, underscore, or hyphen.
- A take is one MOTK Shoot project tagged with `productionId`, `shotId`, and a
  positive integer `take`.
- Google Sheets remains the production-level database in the user's account.
- The local shot folder remains the portable media and session source of truth.
- Captured originals are copied, never moved or deleted.

## Shots table

The first row contains these case-insensitive column names. Unknown columns are
preserved by the Sheet and ignored by MOTK Shoot.

| column | value |
|---|---|
| `shot_id` | stable required key |
| `scene` | scene or sequence label |
| `name` | human-readable shot name |
| `status` | `planned`, `ready`, `shooting`, `review`, `approved`, or a production-defined value |
| `planned_frames` | intended edit-frame count |
| `fps` | playback frame rate, 1-60 |
| `takes` | highest take number / take count for normal sequential takes |
| `best_take` | selected positive take number, blank if unset |
| `frames` | frames in the last reported active edit |
| `duration_s` | exposure duration divided by fps |
| `raw_count` | distinct tether-original paths in the take |
| `notes` | general production and animation notes |
| `handover` | explicit instructions for the next person/session |
| `folder` | portable relative path `<production>/<SHOT_ID>` |
| `updated_at` | ISO 8601 timestamp |

Published-CSV pull accepts the columns above and the aliases `shotid`, `id`,
`shot_name`, and `plannedframes`. The generated `production_report.csv` always
uses the canonical order above and RFC 4180-style quoting.

## Live GAS endpoint

The user deploys `bridge/motk-gas-shoot.gs` as an Apps Script Web app. The token
stays in the deployment URL, matching existing MOTK deployments. Requests use
an `action` query parameter because Apps Script Web apps do not expose a
reliable custom `/shoot` path.

- `GET <exec-url>?token=...&action=shots` returns
  `{ "ok": true, "shots": [ ...rows ] }`.
- `POST ...&action=note` sends JSON with `action`, `shot_id`, optional shot
  columns, and optional `create: true`.
- `POST ...&action=take-results` sends `shot_id`, `take`, `fps`, `frames`,
  `duration_s`, `raw_count`, `folder`, and `updated_at`.

MOTK Shoot sends POST bodies as `text/plain;charset=utf-8` to avoid a browser
CORS preflight. Failed writes remain in a bounded local queue and retry at the
next live pull or session report. Treat the token as a password: do not commit,
log, or share the configured URL.

## Folder layout

The production agent owns one configured root. Browser-provided paths cannot
escape it. Production and shot names are sanitized as individual path segments.

```text
<production-root>/<production>/<SHOT_ID>/
  shot.json
  production_report.csv
  previz/
  plates/
  T01/
    take.json
    backup.zip
    editorial.edl
    editorial.fcpxml
    editorial_aaf_lite.json
    editorial.json
    conform_active_edit.ffconcat
    conform_recipe.txt
    frames/
      frame_00001.jpg
    raw/
      kdr_*.dng
      kdr_*.jpg
    audio/
      track.wav
```

`shot.json` is the latest shot metadata and sheet reference. `take.json`
contains the session result, edit holds, alternate edit lists, active edit id,
and camera configuration snapshot. `backup.zip` is a complete MOTK Shoot v6
project backup. Mirrored frame names reflect active-edit insertion order at
capture time; the immutable capture id and all authoritative edits remain in
the backup and `take.json`.

The six editorial files describe the active edit at the last hand-off write or
session end. They preserve event timing, capture/RAW mapping, audio placement,
and conform commands without changing `frames/`, `raw/`, or `backup.zip`. See
`docs/EDITORIAL_HANDOFF.md` for import and relink guidance.

MOTK3D places renders under `previz/`; plate-producing tools place source or
processed plates under `plates/`. Consumers may add subfolders there but must
not rename the shot folder or overwrite MOTK Shoot take contents.

## After Effects exchange

The optional AE round-trip uses a separately chosen, browser-authorized folder
so it can be a NAS share or synchronized cross-machine directory without giving
the browser unrestricted access to the production root:

```text
<chosen-folder>/MOTK_AE_EXCHANGE/<project-key>/
  .motk-ae-root
  initials/initial_####/{handoff.json,media/,scripts/,README.txt,READY}
  deliveries/delivery_####/{delivery.json,media/,scripts/,README.txt,READY}
  returns/return_####/{preview.*,return.json,READY}
  <project-key>_MOTK_WORKING.aep
```

All version folders are append-only and `READY` is written last. The working
`.aep` is created once and thereafter belongs to the compositor; incremental
delivery scripts update that open project without regenerating it. Returned
media is a Shoot guide/reference and never becomes a captured original. See
`docs/AFTER_EFFECTS_ROUNDTRIP.md` for the full contract.

## Naming

The default take project pattern is `{scene}_{shot}_T{take:2}`. `{shot}` removes
an already-present `<scene>_` prefix, while `{shotId}` always means the complete
stable id. Other tokens are `{scene}`, `{name}`, and `{take}`; each token accepts
an optional zero-pad width such as `{take:3}`. Invalid filename characters become
underscores. Changing a production name or production-agent root after shooting
creates a new destination; move or reconcile existing folders explicitly.
