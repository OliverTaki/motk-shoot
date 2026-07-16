# MOTK Shoot product design: the camera room

MOTK Shoot is the place where an animator receives a prepared shot, captures
frames, checks the immediate result, and leaves a safe record for the next
tool. It is not the place where a production is designed or a film is edited.

## Product boundary

| Keep in the shooting flow | Move out of the shooting flow |
| --- | --- |
| Camera source and camera control | Creating productions and designing shot lists |
| Capture, TEST capture, holds and immediate undo | Managing Google Sheets or GAS deployments |
| Live/review flip and short take playback | Building alternate editorial cuts |
| Onion skin, composition guides and monitor aids | A/B comparison as an editorial decision tool |
| Reference layers and shooting audio/X-Sheet cues | Editorial package management |
| Immutable capture bin and browser project recovery | Pipeline automation and post-production orchestration |
| Imported production/shot/take context | Camera/file automation already owned by Companion |
| Session notes and capture results | Private MegaProd/MegaTools implementation |

Legacy edit, production and interchange data remain readable so existing
projects are not orphaned. They are no longer presented as the normal MOTK
Shoot workflow.

## Information architecture

1. **Shoot** is always the primary surface: live image, timeline and a small
   transport. Desktop keeps all immediate controls visible. Phones keep
   Capture, Live, Play/Pause and stepping visible, with secondary operations in
   a labelled modal that works in portrait and landscape.
2. **Assist** opens only when needed and contains shooting aids: onion skin,
   guides, reference layers, monitor tools and audio/X-Sheet cues.
3. **Session** shows imported production context, the active shot/take, notes,
   results and safe session export. It does not create a production plan.
4. **Settings** contains camera source, resolution, tether/Companion pairing,
   time-lapse, passes, image orientation and external bridge setup.
5. **Focus mode** makes the viewport the product. Capture and Play/Pause are the
   primary controls; the HUD can be hidden. On browsers without the Fullscreen API, including some
   iPhone Safari contexts, the same mode fills the available browser viewport.

## Local media

- Browser storage remains the canonical recovery copy for every capture.
- A new browser session starts with a blank shoot. Existing projects are only
  shown after an explicit Open action; same-tab reload remains recoverable.
- Chrome/Edge and compatible browsers may grant one project-scoped directory
  handle. MOTK Shoot mirrors new JPEG captures into a project folder without
  overwriting an existing file.
- iPhone/iPad browsers do not expose a persistent directory picker. They keep
  captures in browser storage and provide a session backup through the system
  Share sheet / Files flow.
- Companion remains the supported route for RAW originals, vendor camera SDKs,
  production roots and automated mirroring.

## Design principles

- A control appears in the primary UI only if it is used while advancing the
  puppet or checking the immediately captured take.
- Setup is explicit and dismissible; it must never compete visually with the
  shutter.
- Advanced compatibility must not redefine the everyday product.
- Captures remain immutable and recoverable. A UI simplification must never be
  implemented by deleting capture data or changing the `komadori` database.
