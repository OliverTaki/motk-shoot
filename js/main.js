/* MOTK Shoot — boot */
'use strict';
(async () => {
  if (K.ecosystem.isObserver()) {
    K.ecosystem.initObserver();
    return;
  }
  try {
    await K.db.open();
  } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;color:#d7dde6;font-family:system-ui">' +
      '<h2>Storage unavailable</h2><p>MOTK Shoot needs IndexedDB. If you opened this file directly, ' +
      'serve it over http(s) instead — e.g. <code>python -m http.server</code> in this folder, ' +
      'then open <code>http://localhost:8000</code>.</p><p>' + e + '</p></div>';
    return;
  }

  K.camera.init();
  K.viewport.init();
  K.bridge.init();
  await K.production.init();
  await K.project.init();
  await K.localFolder.init();
  await K.aeRoundtrip.init();
  await K.resolveRoundtrip.init();
  await K.autographRoundtrip.init();
  K.timeline.init();
  K.xsheet.init();
  K.ui.init();
  K.shortcuts.init();
  K.ui.applyProjectSettings();

  // The Windows Companion launcher passes the key in a URL fragment. Fragments
  // are not sent to the web server; tether.restorePairingToken removes it from
  // browser history immediately and keeps it only for this tab.
  if (K.tether.launchConnect) {
    K.tether.connect(K.tether.launchAgent || 'ws://127.0.0.1:8793', K.tether.token);
  }

  // populate device list (labels appear after permission is granted)
  try { await K.ui.refreshDeviceList(); } catch {}

  // try to start the camera automatically; if blocked, the Start button remains
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      const s = K.project.current.settings || {};
      await K.camera.start(s.cameraId || undefined, s.resPreset || '1920x1080');
      await K.ui.refreshDeviceList();
    } catch (e) {
      console.warn('Camera autostart failed:', e.message);
      await K.ui.refreshDeviceList().catch(() => {});
      // Only nag if a camera actually exists; a review-only machine shouldn't be scolded.
      if (K.camera.devices && K.camera.devices.length) {
        K.toast('Camera did not start: ' + e.message, 'err', 7000);
      }
    }
    // Open a capture tool ready to shoot: show the live view (or the "Start
    // camera" overlay) whenever a camera is present, rather than freezing on a
    // reviewed still. The last frame still ghosts through as onion skin.
    if (K.camera.running || (K.camera.devices && K.camera.devices.length)) {
      K.viewport.setMode('live');
    }
  } else {
    K.$('#noCamera').classList.remove('hidden');
    K.toast('This browser does not support camera capture', 'err', 5000);
  }

  K.ui.updateModeUI();

  // register service worker for offline use (https / localhost only)
  if (!window.MOTK_LOCAL_EDITION && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // warn before leaving during unsaved-ish operations
  window.addEventListener('beforeunload', (e) => {
    if (K.exporter.busy) { e.preventDefault(); e.returnValue = ''; }
  });
})();
