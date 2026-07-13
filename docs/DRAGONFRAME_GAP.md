# Dragonframe vs MOTK Shoot — gap analysis

Everything Dragonframe (5.x) can do that MOTK Shoot currently cannot,
grouped by area. Legend for the **Path** column:

Implementation note (2026-07-11): Phase 1.1 gphoto2 config list/get/set and
the in-app settings menus are implemented and verified with the dummy backend.
SIGMA fp native still/EXIF verification and A/B test-shot UX remain; native
device discovery and preview now pass on the physical camera.

Phase 1.2 repeated PTP preview streaming, source selection, capture, and clean
stop are implemented and verified end to end with the dummy backend. Specific
camera preview support remains model-specific. SIGMA fp preview passes with the
optional Windows SDK adapter.

Phase 1.3 Windows WSL2/usbipd-win setup is documented and scripted with
read-only checks, explicit privilege boundaries, guarded BUSIDs, and detach
cleanup. An optional Windows SDK adapter now passes physical fp discovery and
preview without redistributing SIGMA binaries; WSL attachment remains optional.

Phase 1.4 test shots are complete: the TEST transport control captures live
and tether originals into the immutable bin, leaves edits and rig-advance
events untouched, survives reload/backup, and stays out of as-shot restore.

Phase 1.5 exposure passes, bracketing, focus drive, and non-overlapping config
ramps are complete and dummy/browser verified. Phase 1.6 is complete as an
isolated WebUSB feasibility lab; its pinned upstream runtime is archived, so
the camera agent remains the production backend. Phase 1 software scope is now
complete, with SIGMA fp hardware verification tracked separately.

Phase 2 is complete: shots and sequential takes now have a production model and
PROD panel; published CSV and user-owned GAS sync are implemented; and the
combined production agent atomically mirrors JPEGs, originals, metadata, audio,
reports, and backups into the shared portable shot-folder contract.

Phases 3–7 are complete: monitor cinematography tools, video/pen/text guides,
multi-track audio, phoneme face sets, X-Sheet printing, speed/range playback,
pop-through, edit/take A/B comparison, editorial interchange, and conform
recipes, second-display assist, remappable/WebHID controls, and read-only LAN
observation are implemented and browser verified. The software roadmap is
complete; physical SIGMA fp and facility-specific editorial checks remain
documented hardware/workflow verification rather than missing software scope.

- `browser` — implementable in the web app as-is
- `agent` — needs the local tether agent (or a new local helper)
- `scope` — deliberately out of scope (owner decision)

| # | Dragonframe feature | Status in MOTK Shoot | Path | Priority |
|---|---|---|---|---|
| **Camera / capture** |
| 1 | Native tethering protocols (Canon/Nikon/Sony/Fuji/Olympus/Panasonic SDKs): full live view from the still sensor | Live view is UVC/HDMI only; stills via tether agent | agent (gphoto2 covers most; Windows needs digiCamControl / vendor SDK) | HIGH |
| 2 | Camera settings UI in-app (aperture, shutter, ISO, WB, quality) with A/B test shots | Body-set only; UVC constraint sliders where exposed | agent (`gphoto2 --set-config`, digiCamControl params) — protocol slot exists in `tether.shoot` | HIGH |
| 3 | Multiple exposures per frame (lighting passes: e.g. front-light + backlight each koma) | **Complete:** named per-project passes, grouped originals, timeline/bin badges, and restored camera config | agent + capture-flow change (sub-exposure list per frame) | MED |
| 4 | Test shots (shoot without inserting into the timeline) | **Complete:** TEST button saves marked captures to the bin; edits/as-shot exclude them | browser + existing tether capture | MED |
| 5 | Focus check with lens drive (rack focus from software) | **Complete:** camera-exposed `manualfocusdrive` choices render as direct controls | agent | LOW |
| 6 | Exposure bracketing / HDR passes | **Complete:** one-click three-shot shutter bracket uses the pass engine | agent | LOW |
| 7 | Video assist devices (HDMI monitors out, second display view) | **Complete:** MONITOR opens a clean fullscreen-capable second-window renderer | browser | MED |
| **Image tools** |
| 8 | Histogram / clipping warnings / digital exposure meter | **Complete:** live histogram plus adjustable clipping zebra | browser | HIGH |
| 9 | Focus peaking magnifier | **Complete:** adjustable monitor edge peaking follows zoom | browser | MED |
| 10 | Chroma key live compositing (shoot against green, see background) | **Complete:** color/tolerance key reveals Behind layers | browser | MED |
| 11 | Anamorphic desqueeze | **Complete:** persisted 1.33–2.0x monitor desqueeze | browser | LOW |
| 12 | Reference video import as rotoscope layer (step frame-by-frame with the animation) | **Complete:** exposure-synced, offset video layer with transforms/keys | browser | HIGH |
| 13 | Vector drawing tools (pen sketches over frames) & text annotations | **Complete:** persistent pen and text layer types | browser | MED |
| 14 | Onion-skin registration offset (shift a ghost to re-align) | **Complete:** independent ghost X/Y and reset | browser | LOW |
| **Audio / lip sync** |
| 15 | Multiple audio tracks with mixing | **Complete:** offset/volume/mute tracks mix in playback, scrub, and export | browser | MED |
| 16 | Automatic/assisted phoneme track reading + mouth-shape "face sets" shown as overlay per koma | **Complete:** generic chart and filename-mapped custom images follow X-Sheet tokens | browser | HIGH |
| 17 | X-Sheet printing / PDF export | **Complete:** dedicated print/PDF action and paged stylesheet | browser | LOW |
| **Production structure** |
| 18 | Scene / take hierarchy (shot naming, multiple takes per scene, take compare) | **Partial:** production shots and sequential one-click takes complete; side-by-side take compare remains #24 | browser | MED |
| 19 | Frames as files on disk in a live folder tree (editor can pick them up mid-shoot) | **Complete:** live JPEG/RAW mirror plus metadata, audio, report, and backup in one shot folder | agent | HIGH |
| 20 | Conform/export to editorial (AAF/EDL/XML) | **Complete:** CMX3600 EDL, FCPXML 1.10, AAF-lite JSON, and a full manifest preserve the active edit | browser | MED |
| 21 | Batch capture file naming conventions / custom naming tokens | **Complete for takes:** configurable production take tokens; stable frame/original names remain intentionally conform-safe | browser+agent | LOW |
| **Playback / review** |
| 22 | Variable-speed playback (1×/2×/half), frame-range loop (in/out points) | **Complete:** 0.25/0.5/1/2x with persisted IN/OUT loop range | browser | MED |
| 23 | Pop-through / flip between current frame and live (X-ray toggle cycling) | **Complete:** hold P for momentary live/selected flip | browser | MED |
| 24 | Side-by-side take comparison | **Complete:** split and full-frame A/B for edits or same-shot takes | browser | LOW |
| **Export** |
| 25 | ProRes / DNxHD masters | **Complete as zero-dependency hand-off:** generated ProRes 422 HQ and DNxHR HQ ffmpeg recipes from the active edit | browser+agent | LOW |
| 26 | Per-frame RAW conform inside the app | **Complete as external conform hand-off:** event/capture/RAW mapping is retained in EDL comments, AAF-lite, and editorial JSON; originals remain untouched | browser+agent | LOW |
| **Hardware / ecosystem** |
| 27 | DMX lighting programming (per-frame lighting cues) | — | scope — external via WS bridge by design | — |
| 28 | Motion control / Arc (rigs, per-frame moves) | — | scope — external via WS bridge by design | — |
| 29 | Dedicated USB/Bluetooth keypad support & custom key mapping | **Complete:** persisted remapping plus input-only WebHID report learning | browser | LOW |
| 30 | Remote monitoring app (iOS "Observer") | **Complete:** allowlisted LAN app serving, capped preview relay, and a no-editor read-only URL mode | browser+agent | LOW |
| 31 | Stereo 3D shooting tools | — | scope (niche) | — |
| 32 | Time-lapse conditional triggers (intervalometer with exposure ramping) | **Complete:** choice-based config ramp over a shot count with completion-driven, non-overlapping capture | agent | LOW |

## Already at parity (for reference)

Live view + zoom/pan focus check, onion skin (multi-frame, blend/difference),
capture with holds, koma-grid timeline with drag reorder and hold stretching,
non-destructive edits + alt versions + as-shot restore + undo/redo, captures
bin, printable X-Sheet, multi-track audio mix/scrub, speed/range playback,
pop-through and A/B comparison, histogram/zebra/peaking/chroma/desqueeze,
video/pen/text guide layers with keyframes and masks,
RAW originals via tether, JPEG-sequence/movie/backup/CSV export, time-lapse,
WS event/command API, project autosave, PWA offline.

## Roadmap completion

All 30 in-scope Dragonframe-gap roadmap items are implemented. Remaining work
is verification on specific physical cameras, HID devices, editorial systems,
and production networks, plus maintenance and user-driven refinement. DMX,
motion control, and stereo 3D remain deliberate scope decisions, not unfinished
roadmap items.
