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

The package itself remains portable and contains only relative media links. At
import time the helper creates a temporary FCPXML with absolute `file:` URIs
for the package on the current computer. If FCPXML is rejected, it performs the
same temporary path resolution for OTIO. The temporary files are deleted after
the import; the immutable exchange package is not rewritten.

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
contracts are automated-test covered. On 2026-07-20, DaVinci Resolve Studio
21.0.1.11 on Windows imported a generated FCPXML through **Workspace > Scripts**
after the portable-path fix, linked three 640x360 stills with exact 2/3/1-frame
holds at 12 fps, rendered a six-frame H.264 MOV, and published an append-only
`return_0001` with `return.json` and `READY`. FCPXML succeeded, so the OTIO
fallback and a deliberately forced missing-media relink remain unobserved in
the real application.
