/* MOTK Shoot Local - focused local stop-motion edition shell. */
'use strict';

(() => {
  const params = new URLSearchParams(location.search);
  const local = params.get('edition') === 'local';
  window.MOTK_LOCAL_EDITION = local;
  if (!local) return;

  document.documentElement.classList.add('local-edition');
  document.title = 'MOTK Shoot Local — Stop Motion Studio';

  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('local-edition');
    const brand = document.querySelector('#brand span');
    if (brand) brand.textContent = 'MOTK Shoot Local';
    const files = document.querySelector('#btnSession');
    if (files) {
      files.textContent = 'Files';
      files.title = 'Local storage, backup and export';
      files.addEventListener('click', () => window.setTimeout(() => {
        if (window.K?.ui?.openPanel) window.K.ui.openPanel('session', 'session');
      }, 0));
    }
    const storageTab = document.querySelector('[data-tab="session"]');
    if (storageTab) {
      storageTab.textContent = 'STORAGE';
      storageTab.title = 'Local capture folder and backup';
    }
    const exportTab = document.querySelector('[data-tab="export"]');
    if (exportTab) {
      exportTab.textContent = 'EXPORT';
      exportTab.title = 'Movie, image sequence, backup and frame tools';
    }
    const message = document.querySelector('#noCamera .dim');
    if (message) message.innerHTML = 'Choose a camera in <b>Settings → Camera</b>, then press Start.<br>Every captured frame enters the local timeline and recovery storage.';

    const ping = () => fetch('/__motk_ping', { cache: 'no-store' }).catch(() => {});
    ping();
    window.setInterval(ping, 4000);
  }, { once: true });
})();
