# Editorial hand-off

MOTK Shoot can turn the active edit into a small, portable editorial package.
The package preserves edit order, frame holds, capture IDs, RAW file names,
notes, audio offsets, and the monitor desqueeze value without modifying any
captured original.

## Export formats

Open **EXPORT → Editorial hand-off** after selecting the edit to deliver.

- **EDL** writes a CMX3600 non-drop-frame picture edit. Each event includes the
  offline JPEG path, immutable capture ID, RAW names, and frame note as comments.
- **FCPXML** writes a Final Cut Pro XML 1.10 sequence. Import it, then relink the
  missing media to the take folder. The generated paths begin at `frames/`.
- **AAF-lite** writes documented JSON containing the same composition and source
  mapping. It is not a binary AAF; use it as a portable interchange manifest or
  convert it with a facility-specific tool.
- **ffmpeg recipe** writes commands for ProRes 422 HQ, DNxHR HQ, and H.264.
  The recipe carries enabled audio tracks, offsets, volume, and mute state.

The full package also contains `editorial.json`, the authoritative MOTK
hand-off model, and `conform_active_edit.ffconcat`, which expands edit holds by
duration while retaining the selected edit order.

## Production take workflow

Run the production agent with a trusted root and connect it in CAM. Open a
production take, then either press **Write package to take** or **End session**.
MOTK Shoot atomically writes these fixed files beside `take.json`:

```text
editorial.edl
editorial.fcpxml
editorial_aaf_lite.json
editorial.json
conform_active_edit.ffconcat
conform_recipe.txt
```

Run the recipe from that take folder. `frames/` supplies the portable offline
or reference images; `raw/` remains untouched for camera-original development
and color-managed relinking. Review the generated commands before running them,
especially codec availability and audio channel layout on the destination
machine.

## Relink and conform checks

1. Confirm the active edit name, fps, event count, and total frames in
   `editorial.json`.
2. Import the EDL or FCPXML and relink picture media to `frames/`.
3. Match RAW media using capture IDs and RAW names in `editorial.json`, EDL
   comments, or AAF-lite events.
4. Confirm first/last frame, holds, audio sync, raster, and desqueeze before
   creating a master.
5. Never rename, overwrite, or delete the take's `raw/` originals or
   `backup.zip` during conform.

