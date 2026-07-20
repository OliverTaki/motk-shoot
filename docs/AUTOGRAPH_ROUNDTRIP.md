# Maxon Autograph round-trip

MOTK Shoot publishes a portable Autograph material package without inventing
or rewriting Autograph's proprietary `.agp` project format.

## Package

Choose a shared folder or download a ZIP. Every publish creates a new folder:

```text
MOTK_AUTOGRAPH_EXCHANGE/<project-key>/
  .motk-autograph-root
  packages/package_####/
    autograph-package.json
    import-list.csv
    shot-template.json
    media/captures/*
    media/references/*
    template/WORKING_TEMPLATE.agp   # only when supplied by the user
    helpers/PUBLISH_RETURN.py
    README.txt
    READY
  returns/return_####/{preview.*,return.json,READY}
```

The package carries fps, raster, planned length, photography timing/holds,
capture IDs, RAW names, and reference layers. `READY` is written last and no
existing package file is overwritten.

## Autograph import

If the studio has an approved `.agp` starter, choose it before publishing. MOTK
copies its bytes unchanged into the package. Otherwise create a project from
the neutral `shot-template.json` settings. In Autograph's Project Panel use
**Ctrl/Cmd+I**, **Import Files**, or drag-and-drop to connect the media listed in
`import-list.csv`. Autograph connects external media rather than embedding it,
so keep the package together. Before moving the working project to another
machine, use **File > Collect Files from Project** and choose the copy option.

The generated JSON is a MOTK exchange contract, not an Autograph clipboard
payload. Automatic `.agp` or clipboard-object generation stays disabled until
its exact schema has been captured and proven against a real Autograph version.

## Return

Render a preview, then run `helpers/PUBLISH_RETURN.py` or use Shoot's manual
**Import preview…** action. Shared-folder returns are append-only and recognized
only after `return.json` and `READY` exist. Returned media is a guide layer; it
does not enter photography or replace an older result.

## Evidence boundary

Package generation, supplied-template byte preservation, path safety,
overwrite refusal, and return contracts are automated-test covered. On
2026-07-20, Maxon Autograph 2026.0.2 on Windows imported the generated three
capture stills plus one previs reference, showed all four 640x360 media items in
the Project Panel, saved a disposable `.agp`, and completed **File > Collect
Files in Project** with the copy option. The collected folder contains the
project plus all four files under `Resources/`, and the collected project was
saved from Autograph. Composition authoring, an Autograph render, and publishing
that render through `PUBLISH_RETURN.py` remain unobserved application steps;
MOTK still does not claim automatic `.agp` or layer-stack generation.
