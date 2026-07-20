# DaVinci Resolve round-trip

MOTK Shoot publishes the active edit as an immutable, versioned Resolve
exchange. It never renames camera originals and never replaces a Resolve
project or an existing timeline.

## Package

Choose a shared folder for cross-machine exchange, or leave it disconnected to
download a ZIP. Each publish creates:

```text
MOTK_RESOLVE_EXCHANGE/<project-key>/
  .motk-resolve-root
  packages/package_####/
    resolve-package.json
    timeline.fcpxml
    timeline.otio
    media/captures/*
    media/references/*
    scripts/IMPORT_MOTK_RESOLVE.py
    scripts/PUBLISH_RETURN.py
    README.txt
    READY
  returns/return_####/{preview.*,return.json,READY}
```

`READY` is written last. Existing files are never overwritten. The manifest
uses only relative paths and records fps, raster, exact holds, record positions,
capture IDs, RAW names, notes, and reference-layer transforms.

## Resolve import

Open or create the compositor/editor-owned Resolve project. Run
`IMPORT_MOTK_RESOLVE.py` from Resolve's **Workspace > Scripts** menu. The helper
uses Resolve's documented `MediaPool.ImportTimelineFromFile` API, imports
reference materials, tries FCPXML first and OTIO second, selects the new
timeline, and saves the current project. It refuses to replace an existing
timeline with the same package name.

Manual import is also supported: import `timeline.fcpxml` or `timeline.otio`,
then relink to the package's `media/captures` directory. A previs-first package
contains blank planned timing plus its reference media; a photography-first
package contains the current active edit and exact frame holds.

## Return

Render a preview, then run `PUBLISH_RETURN.py` or transfer the render manually.
Shoot's **Watch returns** detects only complete `return_####` folders with a
matching manifest and final `READY` marker. **Import preview…** works without a
shared folder. Returned images or movies become guide layers behind live view;
they never enter the capture bin or replace older returns.

## Evidence boundary

Package generation, schema, FCPXML/OTIO parsing, overwrite refusal, and return
contracts are automated-test covered. The helper targets the Resolve 21 API
installed on the development Windows machine. A real facility import/relink and
round-trip remains hardware/application acceptance, so public copy must not
claim that step until it is observed.
