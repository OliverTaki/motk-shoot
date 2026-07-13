/* MOTK Shoot — clean, same-origin second-display renderer. */
'use strict';
const canvas = document.querySelector('#monitorCanvas');
const ctx = canvas.getContext('2d');
const hint = document.querySelector('#monitorHint');
const resize = () => {
  canvas.width = Math.max(1, innerWidth * devicePixelRatio);
  canvas.height = Math.max(1, innerHeight * devicePixelRatio);
};
addEventListener('resize', resize); resize();
canvas.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen().catch(() => {});
});
let warned = false;
const render = () => {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const source = opener && !opener.closed && opener.K?.viewport?.canvas;
    if (source?.width && source?.height) {
      const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
      const w = source.width * scale, h = source.height * scale;
      ctx.drawImage(source, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      hint.classList.add('fade'); warned = false;
    } else if (!warned) { hint.textContent = 'Waiting for the MOTK Shoot window'; hint.classList.remove('fade'); warned = true; }
  } catch {
    hint.textContent = 'The shooting window is no longer available'; hint.classList.remove('fade');
  }
  requestAnimationFrame(render);
};
requestAnimationFrame(render);

