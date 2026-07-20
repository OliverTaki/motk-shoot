# MOTK Shoot contributor rules

Read these files completely before changing the product:

1. `README.md`
2. `docs/PRODUCT_DESIGN_2026-07-16.md`
3. `docs/PRODUCTION_CONTRACT.md`
4. the root workspace `docs/MOTK_SHOOT_SHARED_DEVELOPMENT_NOTE.md` when this
   repository is being developed inside the StopMotionStudios workspace

Non-negotiable invariants:

- MOTK Shoot is the camera-room surface. Do not turn it into an editor,
  production planner, or media-utility collection.
- A capture is committed only after its required original exists. Never invent
  a successful shutter or file write.
- Captures, camera originals, RAW files, exchange packages, and prior returns
  are immutable. New work is versioned and append-only.
- Browser storage remains the recovery copy. Optional folder access is explicit,
  project-scoped, permission-gated, and collision-refusing.
- Monitor guides, previs, chroma previews, and returned comps are never baked
  into captured frames or normal exports.
- Companion owns vendor SDK and unrestricted filesystem operations. Shoot may
  use only browser-granted handles and documented Companion messages.
- Do not include proprietary vendor SDK files, owner media, camera serials,
  pairing keys, OAuth tokens, absolute local paths, or other private material.
- Keep phone portrait/landscape capture usable and keep the normal desktop UI.
- Any public behavior change requires source tests, guide updates, public-site
  synchronization, deployment verification, SMDB NEWS, and shared-ledger update.

For After Effects work, also read `docs/AFTER_EFFECTS_ROUNDTRIP.md`. The working
`.aep` belongs to the compositor and is never regenerated after creation.
Deliveries and returns use monotonically versioned folders with `READY` written
last. The owner reported the Mac After Effects acceptance pass on 2026-07-20.
Resolve and Autograph adapters may proceed only as separate, explicitly claimed
work; do not fold them into the Shoot camera-room surface.

Minimum local checks for an AE change:

```text
node --check js/ae-roundtrip.js
node --check js/ui.js
node tests/ae-roundtrip-selftest.mjs
```

Run the existing fast self-tests affected by the change. Record evidence
honestly as `VERIFIED_AUTOMATED`, `VERIFIED_HARDWARE`, `INFERRED`,
`UNVERIFIED`, or `BLOCKED_EXTERNAL`; never promote one label to another.
