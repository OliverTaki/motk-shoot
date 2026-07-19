# After Effects round-trip contract

Status: beta implementation; package/schema tests and browser flow verified.
Real Adobe After Effects execution is intentionally pending on the owner's Mac,
because the current Windows test machine does not have After Effects.

## Purpose

MOTK Shoot can hand a stop-motion layer to a compositor on another computer and
load a returned composite while photography continues. It also supports the
reverse starting point: build the AE project from previs before the first photo,
then add photographed layers as immutable deliveries.

Shoot does not become a compositor. It publishes media, timing, scripts, and
manifests. After Effects remains the owner of comps, effects, keyframes, layer
organization, renders, and the working `.aep`.

## Supported starts

### Previs first

1. In Shoot, open **Session → Save → After Effects round-trip**.
2. Add one or more previs images or movies. They become Behind guide layers in
   Shoot and guide layers in AE.
3. Enter the intended frame length. Zero captured frames is valid.
4. Create the AE project package.
5. On the Mac, run `BUILD_MOTK_AE_PROJECT.jsx`. It creates a comp at the MOTK
   frame rate and size, places previs, and saves a new working `.aep`.
6. Shoot the first pass. Name it and publish the current take. On the Mac, open
   the existing `.aep` and run that delivery's `IMPORT_MOTK_DELIVERY.jsx`.

### Photography first

Create the initial package after a take already contains frames. The initial
package includes the current active-take timing and its source JPEGs. Later
passes use the same delivery mechanism.

### Existing AE project first

An independently prepared previs `.aep` is also valid. Open and save that
project, make the intended receiving comp active, then run a MOTK delivery's
`IMPORT_MOTK_DELIVERY.jsx`. If the standard `<shot>_MOTK_COMP` exists it is used;
otherwise the active composition is used. The script adds only tagged delivery
layers and does not rebuild or rename the existing comp.

## Operator flow

The panel is deliberately three steps:

1. **Prepare** — add previs; optionally choose a shared exchange folder; create
   the one-time AE project package.
2. **Send layer** — name the photographed pass and publish the current active
   take as a new `delivery_####`.
3. **Return** — watch the shared return folder, or manually import a rendered
   image/movie.

If no folder is selected, Shoot downloads a portable ZIP. Copy or merge later
deliveries into the same `<project>_AE` folder on the compositor machine.

## Exchange layout

When a shared folder is selected, Shoot creates only this project-scoped tree:

```text
<chosen-folder>/MOTK_AE_EXCHANGE/<project-key>/
  .motk-ae-root
  <project-key>_MOTK_WORKING.aep       # created and then owned by AE
  initials/
    initial_0001/
      handoff.json
      media/previs/
      media/reference/
      media/captures/
      scripts/BUILD_MOTK_AE_PROJECT.jsx
      scripts/PUBLISH_RETURN.jsx
      README.txt
      READY
  deliveries/
    delivery_0001/
      delivery.json
      media/captures/
      scripts/IMPORT_MOTK_DELIVERY.jsx
      README.txt
      READY
  returns/
    return_0001/
      preview.mov                       # extension is not fixed
      return.json
      READY
```

`READY` is the commit marker and is written last. A consumer ignores a folder
without it. Existing files cause a hard refusal; they are never silently
replaced. Package paths are relative and work across Windows and macOS.

## AE project behavior

- The builder refuses to overwrite an existing working `.aep`.
- Previs/reference sources become AE guide layers.
- Each MOTK edit event becomes a still layer with `recordIn` and hold duration
  at the project FPS. Reused captures reuse imported footage while preserving
  event timing.
- Delivery layers have stable comments. Re-running the same delivery skips
  already tagged layers.
- A delivery extends a receiving comp when needed but never shortens it.
- Importing a delivery preserves existing comps, layers, effects, keyframes,
  masks, expressions, and project organization.
- The delivery script saves the already-open working project. That normal save
  is distinct from rebuilding or replacing the project.
- Script property access uses AE match names, not localized UI labels.

The initial source files are browser JPEGs and any explicit previs/reference
assets. RAW paths remain in the handoff manifest for later relink/development;
the round-trip never renames, develops, or overwrites RAW originals.

## Returning work to Shoot

Render a preview in AE using the format appropriate for the receiving browser.
Run `PUBLISH_RETURN.jsx`, choose the rendered file, and the script copies it to
a new `return_####` folder. It writes `return.json`, then `READY` last.

Desktop Chrome/Edge can watch the shared folder every five seconds. A returned
movie or image is loaded as a new **AE RETURN** Behind guide layer. The previous
return is hidden but retained. No return enters the Captures bin, changes the
active take, or appears in normal capture exports. Manual **Import preview…**
provides the same behavior without persistent folder access.

The exchange folder may be a NAS or a synchronized folder, but the storage
system must make finished files visible before the `READY` marker. Do not use a
sync system that publishes `READY` ahead of the media.

## Evidence and limitations

`VERIFIED_AUTOMATED`:

- previs-only initial packages;
- zero-capture planned duration;
- active-take hold timing and capture/RAW mapping;
- versioned package names and last-written `READY` contract;
- relative paths only;
- `.aep` overwrite refusal in generated JSX;
- delivery deduplication tags;
- localized-property-safe AE match names;
- return manifest and marker generation;
- browser UI package download and persisted project counter.

`BLOCKED_EXTERNAL` until the owner's Mac test:

- actual script execution in the installed After Effects version;
- `.aep` creation, delivery import, and render-return across Windows/Mac shared
  storage;
- codec compatibility for the owner's chosen preview format.

That external test must not be described as passed merely because the JSX was
generated successfully. Resolve/FCPXML scripting and Autograph package adapters
remain deferred until this AE loop has real end-to-end evidence.
