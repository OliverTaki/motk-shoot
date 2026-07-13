# Multi-track audio and lip sync

The **AUDIO** panel accepts multiple WAV/MP3 tracks. Select a track to edit its
frame offset, volume, or mute state. Playback, frame scrub, waveform display, and
movie export mix every unmuted track. Existing projects containing the original
single audio record migrate automatically without changing the `komadori`
database or its stores.

Enable **Face set**, then write a supported phoneme token in each frame's X-Sheet
note: `A`, `E`, `I`, `O`, `U`, `MBP`, `FV`, `L`, `WQ`, or `REST`. The bundled
generic chart appears over the monitor. To use production artwork, load image
files whose base names start with a token, for example `A.png`, `MBP_closed.png`,
or `REST.webp`. Custom images remain local and are included in v6 backups.

Use **X-Sheet → Print / Save PDF** for a clean paper or PDF exposure sheet. The
print view includes project name, fps, exposure number, seconds, thumbnail/hold,
and dialogue/phoneme notes.
