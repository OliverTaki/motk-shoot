/* MOTK Shoot — UI wiring: panels, transport, capture flow, modals, waveform strip */
'use strict';
K.ui = {
  captureHold: 1,
  blackout: true,     // dark screen during capture so the monitor doesn't light the set
  _lapseTimer: null,
  _lapseState: null,
  _selectedShotId: '',
  _capturing: false,

  init() {
    this._shell();
    this._tabs();
    this._sessionPane();
    this._cameraPane();
    this._onionPane();
    this._layersPane();
    this._guidesPane();
    this._cinePane();
    this._audioPane();
    this._reviewPane();
    this._productionPane();
    this._exportPane();
    this._linkPane();
    this._transport();
    this._topbar();
    this._modals();
    this._dragDrop();
    this._waveform();

    K.bus.on('project:opened', () => { this.applyProjectSettings(); this.refreshEditSelect(); this.renderReviewTargets(); this.renderSession(); });
    K.bus.on('edits:changed', () => { this.refreshEditSelect(); this.renderReviewTargets(); });
    K.bus.on('frames:changed', () => this.updateCounters());
    K.bus.on('mode:changed', () => this.updateModeUI());
    K.bus.on('playback:frame', ({ exposure }) => this.updateCounters(exposure));
    K.bus.on('playback:started', () => this.updateModeUI());
    K.bus.on('playback:stopped', () => this.updateModeUI());
    K.bus.on('camera:started', ({ settings }) => {
      K.$('#noCamera').classList.add('hidden');
      K.$('#badgeRes').textContent = `${settings.width}×${settings.height}`;
      this.buildCamControls();
      this.renderQuickCameraState();
      this.updateModeUI();
    });
    K.bus.on('camera:stopped', () => {
      if (K.viewport.mode === 'live') K.$('#noCamera').classList.remove('hidden');
      K.$('#badgeRes').textContent = '';
      K.$('#camControls').innerHTML = '<div class="dim small">Start a camera to see available controls.</div>';
      this.renderQuickCameraState();
      this.updateModeUI();
    });
    K.bus.on('audio:loaded', ({ name, duration }) => {
      K.$('#audioInfo').textContent = `${name} — ${duration.toFixed(1)}s`;
      K.$('#btnAudioClear').classList.remove('hidden');
      K.$('#waveform').classList.remove('hidden');
      this.redrawWave();
      this.renderAudioTracks();
    });
    K.bus.on('audio:cleared', () => {
      K.$('#audioInfo').textContent = 'No audio loaded. Load a WAV/MP3 to animate to sound (lip sync).';
      K.$('#btnAudioClear').classList.add('hidden');
      K.$('#waveform').classList.add('hidden');
      this.renderAudioTracks();
    });
    K.bus.on('audio:changed', () => { this.renderAudioTracks(); this.redrawWave(); });
    K.bus.on('production:changed', () => { this.renderProduction(); this.renderSession(); });
    K.bus.on('local-folder:changed', () => this.renderLocalFolder());
    K.bus.on('local-folder:wrote', ({ name }) => K.status(`Local copy: ${name}`));
    this.renderSession();
  },

  /* ================= product shell ================= */
  _shell() {
    K.$('#btnAssist').addEventListener('click', () => this.openPanel('assist', 'onion'));
    K.$('#btnSession').addEventListener('click', () => this.openPanel('session', 'session'));
    K.$('#btnSettings').addEventListener('click', () => this.openPanel('settings', 'camera'));
    K.$('#btnClosePanel').addEventListener('click', () => this.closePanel());
    K.$('#btnTransportMore').addEventListener('click', () => {
      K.$('#inMoreCaptureHold').value = this.captureHold;
      this.showModal('shootingControlsModal');
    });
    K.$('#btnFocus').addEventListener('click', () => this.enterFocus());
    K.$('#btnFocusExit').addEventListener('click', () => this.exitFocus());
    K.$('#btnFocusHide').addEventListener('click', () => document.body.classList.add('focus-controls-hidden'));
    K.$('#btnFocusCapture').addEventListener('click', () => this.capture());
    K.$('#btnFocusPlay').addEventListener('click', () => K.playback.toggle({ fromStart: true, loopOverride: true }));
    K.$('#btnQuickCamera').addEventListener('click', () => this.openQuickCamera());
    K.$('#viewportWrap').addEventListener('click', () => {
      if (document.body.classList.contains('focus-mode') && document.body.classList.contains('focus-controls-hidden')) {
        document.body.classList.remove('focus-controls-hidden');
      }
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && document.body.classList.contains('focus-mode')) this.exitFocus({ skipFullscreen: true });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.body.classList.contains('focus-mode')) this.exitFocus();
    }, true);
  },

  activateTab(tab, group, { open = true } = {}) {
    const button = K.$(`#sideTabs button[data-tab="${tab}"]`);
    if (!button) return;
    document.body.dataset.panelGroup = group || button.dataset.group || 'assist';
    K.$$('#sideTabs button').forEach((item) => item.classList.toggle('active', item === button));
    K.$$('.pane').forEach((pane) => pane.classList.toggle('active', pane.dataset.pane === tab));
    K.$('#panelEyebrow').textContent = document.body.dataset.panelGroup.toUpperCase();
    K.$('#panelTitle').textContent = button.title || button.textContent.trim();
    if (open) document.body.classList.add('panel-open');
    for (const [id, name] of [['#btnAssist', 'assist'], ['#btnSession', 'session'], ['#btnSettings', 'settings']]) {
      K.$(id).setAttribute('aria-pressed', String(document.body.classList.contains('panel-open') && document.body.dataset.panelGroup === name));
    }
  },

  openPanel(group, tab) { this.activateTab(tab, group, { open: true }); },
  closePanel() {
    document.body.classList.remove('panel-open');
    for (const id of ['#btnAssist', '#btnSession', '#btnSettings']) K.$(id).setAttribute('aria-pressed', 'false');
  },

  async enterFocus() {
    this.closePanel();
    document.body.classList.add('focus-mode');
    document.body.classList.remove('focus-controls-hidden');
    K.$('#focusProject').textContent = K.project.current?.name || 'Untitled';
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  },

  async exitFocus({ skipFullscreen = false } = {}) {
    document.body.classList.remove('focus-mode', 'focus-controls-hidden');
    if (!skipFullscreen && document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {});
  },

  /* ================= shooting session ================= */
  _sessionPane() {
    const contextFile = K.$('#fileContext');
    K.$('#btnImportContext').addEventListener('click', () => contextFile.click());
    contextFile.addEventListener('change', async () => {
      const file = contextFile.files?.[0];
      if (!file) return;
      try {
        const name = file.name.replace(/\.(csv|json)$/i, '').replace(/[-_]+/g, ' ') || 'Imported production';
        await K.production.importContextText(await file.text(), { name });
        K.toast('Prepared shot context imported', 'ok');
        this.renderSession();
      } catch (error) { K.toast('Context import: ' + error.message, 'err', 5000); }
      contextFile.value = '';
    });
    K.$('#btnPullContext').addEventListener('click', async () => {
      try { await K.production.pullContext(K.$('#inContextUrl').value.trim()); this.renderSession(); }
      catch (error) { K.toast(error.message, 'err', 5000); }
    });
    K.$('#selSessionProduction').addEventListener('change', async (event) => {
      await K.production.selectProduction(event.target.value);
      this._selectedShotId = K.production.active()?.shots[0]?.shotId || '';
      this.renderSession();
    });
    K.$('#selSessionShot').addEventListener('change', (event) => { this._selectedShotId = event.target.value; this.renderSession(); });
    K.$('#btnOpenSessionTake').addEventListener('click', async () => {
      try { await K.production.newTake(this._selectedShotId); this.renderSession(); this.closePanel(); }
      catch (error) { K.toast(error.message, 'err', 5000); }
    });
    K.$('#btnSaveSessionNotes').addEventListener('click', async () => {
      if (!this._selectedShotId) return;
      await K.production.updateShot(this._selectedShotId, {
        notes: K.$('#sessionNotes').value,
        handover: K.$('#sessionHandover').value,
      }, { queue: false });
      K.toast('Shooting notes saved locally', 'ok');
      this.renderSession();
    });
    K.$('#btnFinishSession').addEventListener('click', async () => {
      try { await K.production.endSession({ backup: true }); this.renderSession(); }
      catch (error) { K.toast(error.message, 'err', 5000); }
    });
    K.$('#btnChooseLocalFolder').addEventListener('click', async () => {
      try {
        if (K.localFolder.handle && K.localFolder.permission !== 'granted') await K.localFolder.reconnect();
        else await K.localFolder.choose();
        K.toast('Local capture folder connected', 'ok');
      } catch (error) { if (error.name !== 'AbortError') K.toast(error.message, 'err', 5000); }
    });
    K.$('#btnForgetLocalFolder').addEventListener('click', () => K.localFolder.forget());
    K.$('#btnShareSession').addEventListener('click', async () => {
      try { await K.localFolder.shareBackup(); K.toast('Project backup prepared', 'ok'); }
      catch (error) { if (error.name !== 'AbortError') K.toast(error.message, 'err', 5000); }
    });
  },

  renderSession() {
    const productions = K.production.state.productions || [];
    const productionSelect = K.$('#selSessionProduction');
    const shotSelect = K.$('#selSessionShot');
    if (!productionSelect || !shotSelect) return;
    productionSelect.innerHTML = productions.length ? '' : '<option value="">No context imported</option>';
    for (const production of productions) {
      const option = document.createElement('option'); option.value = production.id; option.textContent = production.name; productionSelect.appendChild(option);
    }
    const production = K.production.active();
    if (production) productionSelect.value = production.id;
    if (production && !production.shots.some((shot) => shot.shotId === this._selectedShotId)) {
      this._selectedShotId = K.production.currentContext()?.shotId || production.shots[0]?.shotId || '';
    }
    shotSelect.innerHTML = production?.shots.length ? '' : '<option value="">No prepared shots</option>';
    for (const shot of production?.shots || []) {
      const option = document.createElement('option'); option.value = shot.shotId; option.textContent = `${shot.scene ? shot.scene + ' / ' : ''}${shot.shotId}${shot.name ? ' — ' + shot.name : ''}`; shotSelect.appendChild(option);
    }
    shotSelect.value = this._selectedShotId;
    const shot = K.production.shot(this._selectedShotId);
    const context = K.production.currentContext();
    K.$('#sessionContextCard').innerHTML = context
      ? `<strong>${this._esc(context.shotId)} · Take ${String(context.take).padStart(2, '0')}</strong><span>${this._esc(context.production)} · ${K.frames.count()} captured frames</span>`
      : shot
        ? `<strong>${this._esc(shot.shotId)}${shot.name ? ' · ' + this._esc(shot.name) : ''}</strong><span>Prepared shot · ${shot.plannedFrames || '—'} frames at ${shot.fps} fps</span>`
        : '<div class="dim small">Import a prepared shot list, then open a take.</div>';
    K.$('#sessionNotes').value = shot?.notes || '';
    K.$('#sessionHandover').value = shot?.handover || '';
    K.$('#inContextUrl').value = production?.contextUrl || production?.sheetRef || '';
    K.$('#btnOpenSessionTake').disabled = !shot;
    K.$('#btnSaveSessionNotes').disabled = !shot;
    const result = K.production.sessionResult();
    K.$('#sessionResult').textContent = `${result.captures} captures · ${result.exposures} exposures · ${result.duration_s}s`;
    this.renderLocalFolder();
  },

  renderLocalFolder() {
    const card = K.$('#localFolderStatus');
    if (!card || !K.localFolder) return;
    const state = K.localFolder.state();
    card.className = 'storage-card' + (state.connected ? ' connected' : state.permission === 'prompt' ? ' attention' : '');
    if (state.connected) card.innerHTML = `<strong>${this._esc(state.folderName)} / ${this._esc(state.projectFolder)}</strong><span>New JPEG captures are mirrored here. Browser storage remains the recovery copy.</span>`;
    else if (!state.supported) card.innerHTML = '<strong>Browser storage + Save to Files</strong><span>This browser does not expose a persistent folder. Use Save / Share backup at the end of the session.</span>';
    else if (state.permission === 'prompt') card.innerHTML = `<strong>${this._esc(state.folderName)}</strong><span>Reconnect this folder to resume local JPEG copies.</span>`;
    else card.innerHTML = '<strong>Browser storage</strong><span>Choose a folder for a second local JPEG copy.</span>';
    K.$('#btnChooseLocalFolder').textContent = state.permission === 'prompt' ? 'Reconnect folder' : 'Choose folder…';
    K.$('#btnChooseLocalFolder').disabled = !state.supported;
    K.$('#btnForgetLocalFolder').disabled = !state.folderName;
    const projectCard = K.$('#projectStorageStatus');
    if (projectCard) {
      projectCard.className = card.className;
      projectCard.innerHTML = state.connected
        ? `<strong>Browser storage + ${this._esc(state.folderName)}</strong><span>Recovery copy in this browser; every new JPEG is also mirrored into ${this._esc(state.projectFolder)}.</span>`
        : state.supported
          ? '<strong>This browser on this device</strong><span>Captures are in local browser storage. Choose a normal folder for an additional JPEG mirror.</span>'
          : '<strong>This browser on this device</strong><span>Captures are in local browser storage. Use Save / Share backup to copy a ZIP into Files or another app.</span>';
    }
    const modalStatus = K.$('#storageChoiceStatus');
    if (modalStatus) {
      modalStatus.className = 'storage-choice-status' + (state.connected ? ' mirrored' : '');
      modalStatus.innerHTML = state.connected
        ? `<strong>Two local copies</strong><br>Browser recovery storage + ${this._esc(state.folderName)} / ${this._esc(state.projectFolder)}`
        : '<strong>One local copy</strong><br>Inside this browser profile on this device (IndexedDB). It is not yet mirrored to a normal folder.';
      K.$('#btnStorageChoose').textContent = state.permission === 'prompt' ? 'Reconnect mirror folder' : 'Choose mirror folder…';
      K.$('#btnStorageChoose').disabled = !state.supported;
      K.$('#btnStorageDisconnect').disabled = !state.folderName;
    }
  },

  /* ================= production pane ================= */
  _productionPane() {
    K.$('#btnNewProduction').addEventListener('click', async () => {
      const name = K.$('#inProductionName').value.trim() || 'New Production';
      await K.production.createProduction({ name });
      this._selectedShotId = '';
      this.renderProduction();
      K.$('#inProductionName').focus();
      K.$('#inProductionName').select();
      K.toast('Production created — name it and save setup', 'ok');
    });
    K.$('#selProduction').addEventListener('change', async (e) => {
      await K.production.selectProduction(e.target.value);
      this._selectedShotId = '';
      this.renderProduction();
    });
    K.$('#btnSaveProduction').addEventListener('click', async () => {
      await K.production.updateProduction({
        name: K.$('#inProductionName').value,
        namingPattern: K.$('#inProductionPattern').value,
        root: K.$('#inProductionRoot').value,
        sheetRef: K.$('#inProductionCsv').value,
        gasUrl: K.$('#inProductionGas').value,
        autoReportMinutes: K.$('#inAutoReport').value,
      });
      K.toast('Production setup saved', 'ok');
      this.renderProduction();
    });
    K.$('#btnAddShot').addEventListener('click', async () => {
      try {
        const shot = await K.production.addShot({
          shotId: K.$('#inNewShotId').value,
          scene: K.$('#inNewScene').value,
          name: K.$('#inNewShotName').value,
          plannedFrames: K.$('#inNewPlanned').value,
          fps: K.$('#inNewShotFps').value,
        });
        this._selectedShotId = shot.shotId;
        for (const id of ['#inNewShotId', '#inNewScene', '#inNewShotName', '#inNewPlanned']) K.$(id).value = '';
        this.renderProduction();
      } catch (e) { K.toast(e.message, 'err', 4000); }
    });
    K.$('#btnSaveShot').addEventListener('click', () => this.saveSelectedShot());
    K.$('#btnNewTake').addEventListener('click', async () => {
      try { await this.saveSelectedShot(); await K.production.newTake(this._selectedShotId); this.renderProduction(); }
      catch (e) { K.toast('New take: ' + e.message, 'err', 4000); }
    });
    K.$('#btnEndSession').addEventListener('click', () => K.production.endSession({ backup: true }).catch((e) => K.toast(e.message, 'err', 5000)));
    K.$('#btnPullCsv').addEventListener('click', async () => {
      try { await K.production.pullPublishedCsv(K.$('#inProductionCsv').value.trim()); this.renderProduction(); }
      catch (e) { K.toast('CSV sync: ' + e.message, 'err', 5000); }
    });
    K.$('#btnPullGas').addEventListener('click', async () => {
      try { await K.production.updateProduction({ gasUrl: K.$('#inProductionGas').value }); await K.production.pullGas(); this.renderProduction(); }
      catch (e) { K.toast('Live sync: ' + e.message, 'err', 5000); }
    });
    K.$('#btnProdReport').addEventListener('click', () => K.production.downloadReport().catch((e) => K.toast(e.message, 'err')));
    this.renderProduction();
  },

  async saveSelectedShot() {
    if (!this._selectedShotId) return;
    const shot = await K.production.updateShot(this._selectedShotId, {
      status: K.$('#selShotStatus').value,
      plannedFrames: K.$('#editPlanned').value,
      fps: K.$('#editShotFps').value,
      bestTake: K.$('#editBestTake').value,
      notes: K.$('#editShotNotes').value,
      handover: K.$('#editShotHandover').value,
    });
    if (K.production.active()?.gasUrl) K.production.flushPending().catch(() => {});
    K.toast(`Saved ${shot.shotId}`, 'ok');
    this.renderProduction();
  },

  renderProduction() {
    const select = K.$('#selProduction');
    if (!select) return;
    select.innerHTML = '';
    for (const production of K.production.state.productions) {
      const option = document.createElement('option'); option.value = production.id; option.textContent = production.name; select.appendChild(option);
    }
    const production = K.production.active();
    if (!production) {
      const option = document.createElement('option'); option.textContent = 'Create a production'; option.value = ''; select.appendChild(option);
      K.$('#productionShotList').innerHTML = '<div class="dim small">Create a production to add shots.</div>';
      K.$('#shotEditor').classList.add('hidden');
      K.$('#prodSyncInfo').textContent = 'No production selected.';
      return;
    }
    select.value = production.id;
    K.$('#inProductionName').value = production.name;
    K.$('#inProductionPattern').value = production.namingPattern;
    K.$('#inProductionRoot').value = production.root;
    K.$('#inProductionCsv').value = production.sheetRef;
    K.$('#inProductionGas').value = production.gasUrl;
    K.$('#inAutoReport').value = production.autoReportMinutes;
    const context = K.production.currentContext();
    K.$('#prodCurrentTake').textContent = context ? `${context.shotId} · T${String(context.take).padStart(2, '0')}` : 'No take linked';
    K.$('#prodSyncInfo').textContent = `${production.shots.length} shots · ${production.pending.length} pending` +
      (production.lastSyncAt ? ` · synced ${new Date(production.lastSyncAt).toLocaleString()}` : '');

    if (!production.shots.some((s) => s.shotId === this._selectedShotId)) {
      this._selectedShotId = context?.shotId || production.shots[0]?.shotId || '';
    }
    const list = K.$('#productionShotList'); list.innerHTML = '';
    for (const shot of production.shots) {
      const row = document.createElement('div'); row.className = 'shot-row' + (shot.shotId === this._selectedShotId ? ' sel' : '');
      const main = document.createElement('div'); main.className = 'shot-main';
      const name = document.createElement('div'); name.className = 'shot-name'; name.textContent = `${shot.scene ? shot.scene + ' · ' : ''}${shot.shotId} ${shot.name ? '— ' + shot.name : ''}`;
      const meta = document.createElement('div'); meta.className = 'shot-meta'; meta.textContent = `${shot.plannedFrames || '—'} frames · ${shot.fps} fps${shot.dirty ? ' · local changes' : ''}`;
      main.append(name, meta);
      const chip = document.createElement('span'); chip.className = 'status-chip ' + shot.status; chip.textContent = shot.status;
      row.append(main, chip);
      row.addEventListener('click', () => { this._selectedShotId = shot.shotId; this.renderProduction(); });
      list.appendChild(row);
    }
    if (!production.shots.length) list.innerHTML = '<div class="dim small">No shots yet. Add one above or pull a sheet.</div>';
    this.renderShotEditor();
  },

  renderShotEditor() {
    const shot = K.production.shot(this._selectedShotId);
    const editor = K.$('#shotEditor');
    if (!shot) { editor.classList.add('hidden'); return; }
    editor.classList.remove('hidden');
    K.$('#shotEditorTitle').textContent = `${shot.scene ? shot.scene + ' / ' : ''}${shot.shotId} ${shot.name || ''}`;
    K.$('#selShotStatus').value = shot.status;
    K.$('#editPlanned').value = shot.plannedFrames;
    K.$('#editShotFps').value = shot.fps;
    K.$('#editBestTake').value = shot.bestTake || 0;
    K.$('#editShotNotes').value = shot.notes;
    K.$('#editShotHandover').value = shot.handover;
    const linked = K.production.currentContext()?.shotId === shot.shotId;
    K.$('#btnEndSession').disabled = !linked;
  },

  /* ================= capture ================= */
  async capture(options = {}) {
    const test = !!options.test;
    if (this._capturing) return;
    if (!K.camera.running) { K.toast('Camera is not running', 'err'); return; }
    if (K.playback.playing) K.playback.stop();
    this._capturing = true;
    const bo = this.blackout ? K.$('#blackout') : null;
    let meta = null;
    try {
      if (bo) {
        bo.classList.remove('hidden');
        await K.sleep(160); // let the panel actually go dark before exposing
      }
      const shot = await K.camera.capture();
      meta = await K.frames.add(shot, {
        hold: this.captureHold,
        isTest: test,
        insert: false,
      });
      // fire the real camera shutter & keep RAW originals
      let tetherP = null;
      if (K.tether.armed()) {
        tetherP = K.tether.passesEnabled && K.tether.passPresets.length
          ? K.tether.shootPasses(meta.id)
          : K.tether.shoot(meta.id);
      }
      // A frame is not complete until the real camera reports files on disk.
      if (tetherP) await tetherP;
      const completedBlob = await K.frames.getBlob(meta.id) || shot.blob;
      K.localFolder.writeCapture({ id: meta.id, blob: completedBlob, isTest: test }).catch((error) => {
        console.warn('Local capture mirror:', error.message);
        K.toast('Local folder copy failed; the browser copy is safe', 'err', 5000);
      });
      if (!test) K.frames.insertCapture(meta.id);
      if (!bo) {
        const flash = K.$('#captureFlash');
        flash.classList.add('on');
        requestAnimationFrame(() => setTimeout(() => flash.classList.remove('on'), 30));
      }
      if (test) {
        const capture = K.frames.captureOf(meta.id);
        K.bus.emit('test:captured', {
          id: meta.id,
          captureIndex: K.frames.captures.length - 1,
          raw: capture ? capture.raw : '',
        });
        K.toast('Test shot saved to the captures bin', 'ok');
      } else {
        if (K.viewport.mode !== 'live') K.viewport.setMode('live');
        K.timeline.scrollToEnd();
        K.bus.emit('frame:captured', { id: meta.id, index: K.frames.count() - 1, hold: meta.hold });
      }
      return meta;
    } catch (e) {
      console.error(e);
      if (meta) await K.frames.discardFailedCapture(meta.id);
      K.toast('Capture failed: ' + e.message, 'err');
    } finally {
      if (bo) bo.classList.add('hidden');
      this._capturing = false;
    }
  },

  /* ================= navigation (per koma / exposure) ================= */
  step(dir) {
    K.playback.stop();
    const fs = K.frames;
    const vp = K.viewport;
    const total = fs.totalExposures();
    if (total === 0) return;
    if (vp.mode === 'live') {
      if (dir < 0) vp.setExposure(total - 1);
      // step forward from live: nothing
    } else {
      const next = vp.reviewExp + dir;
      if (next >= total) vp.setMode('live');
      else vp.setExposure(Math.max(0, next));
    }
    if (vp.mode === 'review') {
      K.audio.playSlice(vp.reviewExp, K.project.current.fps);
    }
    this.updateCounters();
  },

  goFirst() { K.playback.stop(); if (K.frames.count()) K.viewport.setExposure(0); },
  goLast() { K.playback.stop(); if (K.frames.count()) K.viewport.setExposure(K.frames.totalExposures() - 1); },
  toggleLive() {
    K.playback.stop();
    if (K.viewport.mode === 'live') {
      if (K.frames.count()) K.viewport.setMode('review', K.frames.count() - 1);
    } else K.viewport.setMode('live');
  },

  deleteCurrent() {
    const fs = K.frames;
    if (!fs.count()) return;
    const idx = K.viewport.mode === 'review' ? K.viewport.reviewIdx : fs.count() - 1;
    K.timeline.deleteFrame(idx);
  },

  holdDelta(d) {
    if (K.viewport.mode !== 'review') return;
    const f = K.frames.list[K.viewport.reviewIdx];
    if (f) K.frames.setHold(K.viewport.reviewIdx, (f.hold || 1) + d);
  },

  toggleOnion() {
    const chk = K.$('#chkOnion');
    chk.checked = !chk.checked;
    chk.dispatchEvent(new Event('change'));
  },
  toggleLoop() {
    K.playback.loop = !K.playback.loop;
    K.$('#btnLoop').classList.toggle('on', K.playback.loop);
    K.$('#btnMoreLoop').classList.toggle('on', K.playback.loop);
    this.persistSettings();
  },
  toggleMute() {
    const chk = K.$('#chkAudioPlay');
    chk.checked = !chk.checked;
    chk.dispatchEvent(new Event('change'));
  },
  cycleGrid() {
    const sel = K.$('#selGrid');
    const order = ['off', 'thirds', 'quarters', 'golden'];
    sel.value = order[(order.indexOf(sel.value) + 1) % order.length];
    sel.dispatchEvent(new Event('change'));
  },

  /* ================= counters / badges ================= */
  updateCounters(playExposure = null) {
    const fs = K.frames;
    const fps = K.project.current ? K.project.current.fps : 12;
    const total = fs.totalExposures();
    let cur;
    if (playExposure !== null) cur = playExposure + 1;
    else if (K.viewport.mode === 'live') cur = total;
    else cur = K.viewport.reviewExp + 1;
    K.$('#frameCounter').textContent = `${cur} / ${total}`;
    K.$('#timecode').textContent = K.timecode(playExposure !== null ? playExposure : (cur === total ? total : cur - 1), fps);
    K.$('#focusCounter').textContent = `${cur} / ${total}`;
    this.redrawWave(playExposure);
  },

  updateModeUI() {
    const badge = K.$('#badgeMode');
    if (K.playback.playing) {
      badge.textContent = 'PLAY';
      badge.className = 'badge play';
    } else if (K.viewport.mode === 'live') {
      badge.textContent = K.camera.running ? 'LIVE' : 'NO CAM';
      badge.className = 'badge live';
      K.$('#noCamera').classList.toggle('hidden', K.camera.running);
    } else {
      badge.textContent = `FRAME ${K.viewport.reviewIdx + 1} · KOMA ${K.viewport.reviewExp + 1}`;
      badge.className = 'badge review';
      K.$('#noCamera').classList.add('hidden');
    }
    K.$('#btnLive').classList.toggle('on', K.viewport.mode === 'live' && !K.playback.playing);
    K.$('#btnPlay').textContent = K.playback.playing ? '■' : '▶';
    K.$('#btnFocusPlay').textContent = K.playback.playing ? 'PAUSE' : 'PLAY';
    K.$('#btnFocusPlay').setAttribute('aria-pressed', String(K.playback.playing));
    K.timeline.updateSelection();
    this.updateCounters();
  },

  /* ================= waveform strip ================= */
  _waveform() {
    const cv = K.$('#waveform');
    cv.addEventListener('click', (e) => {
      if (!K.audio.buffer || !cv._span) return;
      const rect = cv.getBoundingClientRect();
      const exp = Math.floor(((e.clientX - rect.left) / rect.width) * cv._span);
      if (exp < K.frames.totalExposures()) {
        K.playback.stop();
        K.viewport.setExposure(exp);
      }
      K.audio.playSlice(exp, K.project.current.fps);
    });
  },

  redrawWave(playExposure = null) {
    const cv = K.$('#waveform');
    if (cv.classList.contains('hidden') || !K.audio.buffer) return;
    const fs = K.frames;
    let exp;
    if (playExposure !== null) exp = playExposure;
    else if (K.viewport.mode === 'live') exp = fs.totalExposures();
    else exp = K.viewport.reviewExp;
    K.audio.drawWave(cv, exp, K.project.current.fps, fs.totalExposures());
  },

  /* ================= tabs ================= */
  _tabs() {
    K.$$('#sideTabs button').forEach((b) => {
      b.addEventListener('click', () => this.activateTab(b.dataset.tab, b.dataset.group));
    });
    this.activateTab('onion', 'assist', { open: false });
  },

  /* ================= camera pane ================= */
  _cameraPane() {
    const sel = K.$('#selCamera');
    K.$('#btnStartCam').addEventListener('click', () => this.startCamera());
    K.$('#btnCamRestart').addEventListener('click', () => this.startCamera());
    K.$('#btnCamStop').addEventListener('click', () => K.camera.stop());
    // hot-plug: refresh the device list when a camera appears/disappears
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        await this.refreshDeviceList().catch(() => {});
        K.toast('Camera list updated');
      });
    }
    sel.addEventListener('change', () => this.startCamera());
    K.$('#selRes').addEventListener('change', () => { this.startCamera(); this.persistSettings(); });

    K.$('#chkPhotoMode').addEventListener('change', (e) => { K.camera.photoMode = e.target.checked; this.persistSettings(); });
    K.$('#chkBlackout').addEventListener('change', (e) => { this.blackout = e.target.checked; this.persistSettings(); });
    const q = K.$('#inJpegQ');
    q.addEventListener('input', () => {
      K.camera.jpegQuality = parseFloat(q.value);
      K.$('#outJpegQ').textContent = q.value;
      this.persistSettings();
    });
    for (const [id, prop] of [['#chkMirrorH', 'mirrorH'], ['#chkMirrorV', 'mirrorV'], ['#chkRot180', 'rot180']]) {
      K.$(id).addEventListener('change', (e) => {
        K.camera[prop] = e.target.checked;
        K.viewport.invalidate();
        this.persistSettings();
      });
    }
    K.$('#btnCamAuto').addEventListener('click', async () => {
      await K.camera.resetAuto();
      this.buildCamControls();
    });

    /* time-lapse */
    K.$('#btnLapse').addEventListener('click', () => {
      if (this._lapseTimer) {
        this.stopLapse();
      } else {
        const sec = Math.max(0.5, parseFloat(K.$('#inLapse').value) || 5);
        const ramp = this._readLapseRamp();
        this._lapseState = { sec, shot: 0, ramp };
        this._lapseTimer = true;
        K.$('#btnLapse').textContent = 'Stop time-lapse';
        K.status(`Time-lapse: capturing every ${sec}s`);
        this._lapseTick();
      }
    });
    K.$('#chkLapseRamp').addEventListener('change', (e) => {
      K.$('#lapseRampControls').classList.toggle('hidden', !e.target.checked);
      this.persistSettings();
    });
    K.$('#selLapseRampPath').addEventListener('change', () => { this.renderLapseRampControls(true); this.persistSettings(); });
    K.$('#selLapseRampEnd').addEventListener('change', () => this.persistSettings());
    K.$('#inLapseRampShots').addEventListener('change', () => this.persistSettings());
  },

  stopLapse() {
    if (this._lapseTimer && this._lapseTimer !== true) clearTimeout(this._lapseTimer);
    this._lapseTimer = null;
    this._lapseState = null;
    K.$('#btnLapse').textContent = 'Start time-lapse';
    K.status('');
  },

  _readLapseRamp() {
    if (!K.$('#chkLapseRamp').checked) return null;
    const path = K.$('#selLapseRampPath').value;
    const config = K.tether.configs.find((c) => c.path === path);
    const endValue = K.$('#selLapseRampEnd').value;
    const shots = K.clamp(parseInt(K.$('#inLapseRampShots').value, 10) || 24, 2, 9999);
    if (!K.tether.connected || !config?.choices?.length || !endValue) {
      K.toast('Connect tether and choose a valid ramp setting', 'err');
      return null;
    }
    return { path, choices: [...config.choices], startValue: config.current, endValue, shots };
  },

  async _lapseTick() {
    const state = this._lapseState;
    if (!this._lapseTimer || !state) return;
    try {
      if (state.ramp) {
        const r = state.ramp;
        const from = Math.max(0, r.choices.indexOf(r.startValue));
        const to = Math.max(0, r.choices.indexOf(r.endValue));
        const progress = Math.min(1, state.shot / Math.max(1, r.shots - 1));
        const value = r.choices[Math.round(from + (to - from) * progress)];
        await K.tether.setConfigQuiet(r.path, value);
        K.status(`Time-lapse ${state.shot + 1}: ${value}`);
      }
      await this.capture();
      state.shot++;
    } catch (e) {
      K.toast('Time-lapse stopped: ' + e.message, 'err', 5000);
      this.stopLapse();
      return;
    }
    if (this._lapseTimer && this._lapseState === state) {
      this._lapseTimer = setTimeout(() => this._lapseTick(), state.sec * 1000);
    }
  },

  renderLapseRampControls(preserveEnd = false) {
    const pathSelect = K.$('#selLapseRampPath');
    const endSelect = K.$('#selLapseRampEnd');
    if (!pathSelect || !endSelect) return;
    const oldPath = pathSelect.value;
    const oldEnd = endSelect.value;
    const configs = K.tether.configs.filter((c) => c.choices?.length > 1 && !c.readonly && !/manualfocusdrive$/i.test(c.path));
    pathSelect.innerHTML = '';
    for (const config of configs) {
      const option = document.createElement('option'); option.value = config.path; option.textContent = config.label || config.path.split('/').pop(); pathSelect.appendChild(option);
    }
    if (configs.some((c) => c.path === oldPath)) pathSelect.value = oldPath;
    const config = configs.find((c) => c.path === pathSelect.value);
    endSelect.innerHTML = '';
    for (const value of config?.choices || []) {
      const option = document.createElement('option'); option.value = value; option.textContent = value; endSelect.appendChild(option);
    }
    if (preserveEnd && config?.choices.includes(oldEnd)) endSelect.value = oldEnd;
  },

  async startCamera() {
    return this.startCameraFrom(K.$('#selCamera').value || undefined, K.$('#selRes').value);
  },

  async startCameraFrom(deviceId, resolution) {
    try {
      await K.camera.start(deviceId || undefined, resolution || K.$('#selRes').value);
      await this.refreshDeviceList();
      const s = K.project.current.settings;
      s.cameraId = K.camera.settings()?.deviceId || K.$('#selCamera').value;
      s.resPreset = resolution || K.$('#selRes').value;
      K.$('#selRes').value = s.resPreset;
      K.$('#selQuickRes').value = s.resPreset;
      this.persistSettings();
      return true;
    } catch (e) {
      console.error(e);
      K.toast('Camera error: ' + e.message, 'err', 4000);
      K.$('#noCamera').classList.remove('hidden');
      this.renderQuickCameraState(e.message);
      return false;
    }
  },

  async refreshDeviceList() {
    const cur = K.camera.settings();
    const devices = await K.camera.listDevices();
    for (const id of ['#selCamera', '#selQuickCamera']) {
      const sel = K.$(id);
      if (!sel) continue;
      const previous = sel.value;
      sel.innerHTML = '';
      devices.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || `Camera ${i + 1}`;
        sel.appendChild(o);
      });
      const tether = document.createElement('option');
      tether.value = '__tether__';
      tether.textContent = 'Tether live view (PTP)';
      sel.appendChild(tether);
      const wanted = cur?.deviceId || previous || K.project.current?.settings?.cameraId || '';
      if ([...sel.options].some((option) => option.value === wanted)) sel.value = wanted;
    }
    this.renderQuickCameraState();
  },

  async openQuickCamera() {
    await this.refreshDeviceList().catch(() => {});
    const resolution = K.project.current?.settings?.resPreset || K.$('#selRes').value;
    K.$('#selQuickRes').value = resolution;
    this.renderQuickCameraState();
    this.showModal('cameraQuickModal');
  },

  renderQuickCameraState(error = '') {
    const state = K.$('#quickCameraState');
    if (!state) return;
    state.className = 'quick-state' + (K.camera.running ? ' running' : '');
    if (error) state.textContent = `Camera could not start: ${error}`;
    else if (K.camera.running) {
      const settings = K.camera.settings() || {};
      const option = K.$('#selQuickCamera')?.selectedOptions?.[0];
      state.textContent = `Live: ${option?.textContent || 'camera'} · ${settings.width || '?'} × ${settings.height || '?'}`;
    } else state.textContent = 'Camera is stopped. Captured frames and the current project remain open.';
    if (K.$('#btnQuickCameraStop')) K.$('#btnQuickCameraStop').disabled = !K.camera.running;
  },

  /* build sliders from MediaStreamTrack capabilities */
  buildCamControls() {
    const box = K.$('#camControls');
    box.innerHTML = '';
    if (K.camera.source === 'tether') {
      box.innerHTML = '<div class="dim small">Use the PTP camera settings in the Tether section below.</div>';
      return;
    }
    const caps = K.camera.capabilities();
    const cur = K.camera.settings() || {};
    const defs = [
      ['zoom', 'Zoom', null],
      ['focusDistance', 'Focus', { focusMode: 'manual' }],
      ['exposureTime', 'Shutter', { exposureMode: 'manual' }],
      ['exposureCompensation', 'Exp. comp', null],
      ['iso', 'ISO', { exposureMode: 'manual' }],
      ['colorTemperature', 'White bal (K)', { whiteBalanceMode: 'manual' }],
      ['brightness', 'Brightness', null],
      ['contrast', 'Contrast', null],
      ['saturation', 'Saturation', null],
      ['sharpness', 'Sharpness', null],
    ];
    let built = 0;
    for (const [key, label, modeReq] of defs) {
      const c = caps[key];
      if (!c || c.min === undefined || c.min === c.max) continue;
      built++;
      const wrap = document.createElement('div');
      wrap.className = 'camctl';
      const head = document.createElement('div');
      head.className = 'cl';
      const out = document.createElement('span');
      out.textContent = cur[key] !== undefined ? String(cur[key]) : '';
      head.innerHTML = `<span>${label}</span>`;
      head.appendChild(out);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = c.min; input.max = c.max;
      input.step = c.step || (c.max - c.min) / 100;
      if (cur[key] !== undefined) input.value = cur[key];
      input.addEventListener('input', K.debounce(async () => {
        const v = parseFloat(input.value);
        out.textContent = String(v);
        try {
          await K.camera.applyAdvanced({ ...(modeReq || {}), [key]: v });
        } catch (err) { console.warn(key, err); }
      }, 60));
      wrap.appendChild(head);
      wrap.appendChild(input);
      box.appendChild(wrap);
    }
    if (!built) box.innerHTML = '<div class="dim small">This camera exposes no manual controls to the browser. Set exposure/focus on the camera body, or use an HDMI→USB capture device.</div>';
  },

  /* ================= onion pane ================= */
  _onionPane() {
    const o = K.viewport.onion;
    K.$('#chkOnion').addEventListener('change', (e) => { o.on = e.target.checked; K.viewport._refreshAsync(); this.persistSettings(); });
    K.$('#inOnionN').addEventListener('input', (e) => { o.frames = +e.target.value; K.$('#outOnionN').textContent = e.target.value; K.viewport._refreshAsync(); this.persistSettings(); });
    K.$('#inOnionA').addEventListener('input', (e) => { o.alpha = +e.target.value; K.$('#outOnionA').textContent = e.target.value; K.viewport.invalidate(); this.persistSettings(); });
    K.$('#selOnionMode').addEventListener('change', (e) => { o.mode = e.target.value; K.viewport.invalidate(); this.persistSettings(); });
    K.$('#chkOnionNext').addEventListener('change', (e) => { o.next = e.target.checked; K.viewport._refreshAsync(); this.persistSettings(); });
    const onionOffset = () => { o.offsetX = parseInt(K.$('#inOnionX').value, 10) || 0; o.offsetY = parseInt(K.$('#inOnionY').value, 10) || 0; K.viewport.invalidate(); this.persistSettings(); };
    K.$('#inOnionX').addEventListener('change', onionOffset); K.$('#inOnionY').addEventListener('change', onionOffset);
    K.$('#btnOnionReset').addEventListener('click', () => { o.offsetX = 0; o.offsetY = 0; K.$('#inOnionX').value = 0; K.$('#inOnionY').value = 0; K.viewport.invalidate(); this.persistSettings(); });
  },

  /* ================= layers pane ================= */
  _layersPane() {
    K.$('#btnLayerImg').addEventListener('click', () => K.$('#fileLayerImg').click());
    K.$('#btnLayerVideo').addEventListener('click', () => K.$('#fileLayerVideo').click());
    K.$('#fileLayerImg').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) await K.layers.addImage(f);
      e.target.value = '';
    });
    K.$('#fileLayerVideo').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) await K.layers.addVideo(f);
      e.target.value = '';
    });
    K.$('#btnLayerRect').addEventListener('click', () => K.layers.addShape('rect'));
    K.$('#btnLayerEllipse').addEventListener('click', () => K.layers.addShape('ellipse'));
    K.$('#btnLayerCross').addEventListener('click', () => K.layers.addShape('cross'));
    K.$('#btnLayerMask').addEventListener('click', () => K.layers.addShape('mask'));
    K.$('#btnLayerPen').addEventListener('click', () => K.layers.addPen());
    K.$('#btnLayerText').addEventListener('click', () => K.layers.addText());

    const sel = () => K.layers.selected();
    K.$('#lpName').addEventListener('change', (e) => K.layers.update({ name: e.target.value }));
    K.$('#lpOpacity').addEventListener('input', (e) => {
      K.layers.update({ opacity: +e.target.value });
      K.$('#lpOpacityOut').textContent = (+e.target.value).toFixed(2);
    });
    K.$('#lpHalf').addEventListener('click', () => { K.layers.update({ opacity: 0.5 }); this.renderLayerProps(); });
    K.$('#lpFull').addEventListener('click', () => { K.layers.update({ opacity: 1 }); this.renderLayerProps(); });
    K.$('#lpBehind').addEventListener('click', () => {
      const l = sel();
      if (l) { K.layers.update({ behind: !l.behind }); this.renderLayerProps(); }
    });
    K.$('#lpX').addEventListener('change', (e) => K.layers.update({ x: +e.target.value || 0 }));
    K.$('#lpY').addEventListener('change', (e) => K.layers.update({ y: +e.target.value || 0 }));
    K.$('#lpScale').addEventListener('change', (e) => K.layers.update({ scale: K.clamp(+e.target.value || 100, 1, 2000) }));
    K.$('#lpRot').addEventListener('change', (e) => K.layers.update({ rot: +e.target.value || 0 }));
    K.$('#lpW').addEventListener('change', (e) => K.layers.update({ w: Math.max(2, +e.target.value || 100) }));
    K.$('#lpH').addEventListener('change', (e) => K.layers.update({ h: Math.max(2, +e.target.value || 100) }));
    K.$('#lpColor').addEventListener('input', (e) => K.layers.update({ color: e.target.value }));
    K.$('#lpFill').addEventListener('change', (e) => K.layers.update({ fill: e.target.checked }));
    K.$('#lpInvert').addEventListener('change', (e) => K.layers.update({ invert: e.target.checked }));
    K.$('#lpText').addEventListener('change', (e) => K.layers.update({ text: e.target.value }));
    K.$('#lpFontSize').addEventListener('change', (e) => K.layers.update({ fontSize: K.clamp(+e.target.value || 72, 6, 500) }));
    K.$('#lpVideoOffset').addEventListener('change', (e) => K.layers.update({ videoOffset: parseInt(e.target.value, 10) || 0 }));
    K.$('#lpKeySet').addEventListener('click', () => {
      K.layers.setKey(K.viewport.currentExposure());
      this.renderLayerProps();
    });
    K.$('#lpKeyClear').addEventListener('click', () => { K.layers.clearKeys(); this.renderLayerProps(); });
    K.$('#lpDelete').addEventListener('click', () => {
      const l = sel();
      if (l && confirm(`Delete layer "${l.name}"?`)) K.layers.remove(l.id);
    });

    K.bus.on('layers:changed', () => { this.renderLayerList(); this.renderLayerProps(); });
    K.bus.on('layers:nudged', () => {
      const l = sel();
      if (l) { K.$('#lpX').value = l.x; K.$('#lpY').value = l.y; }
    });
  },

  renderLayerList() {
    const box = K.$('#layerList');
    box.innerHTML = '';
    if (!K.layers.list.length) {
      box.innerHTML = '<div class="dim small">No layers yet. Add a reference image, a primitive shape, or a garbage mask.</div>';
      return;
    }
    // top of the list = drawn last (frontmost)
    [...K.layers.list].reverse().forEach((l) => {
      const row = document.createElement('div');
      row.className = 'layer-row' + (l.id === K.layers.selectedId ? ' sel' : '');
      const eye = document.createElement('button');
      eye.className = 'lbtn' + (l.visible ? ' on' : '');
      eye.textContent = l.visible ? '👁' : '–';
      eye.title = 'Show / hide';
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        l.visible = !l.visible;
        K.project.saveSoon();
        K.viewport.invalidate();
        this.renderLayerList();
      });
      const type = document.createElement('span');
      type.className = 'ltype';
      type.textContent = l.type.toUpperCase();
      const name = document.createElement('span');
      name.className = 'lname';
      name.textContent = l.name + (l.keys && l.keys.length ? ` ◆${l.keys.length}` : '');
      const up = document.createElement('button');
      up.className = 'lbtn'; up.textContent = '▲'; up.title = 'Bring forward';
      up.addEventListener('click', (e) => { e.stopPropagation(); K.layers.moveLayer(l.id, 1); });
      const dn = document.createElement('button');
      dn.className = 'lbtn'; dn.textContent = '▼'; dn.title = 'Send back';
      dn.addEventListener('click', (e) => { e.stopPropagation(); K.layers.moveLayer(l.id, -1); });
      row.append(eye, type, name, up, dn);
      row.addEventListener('click', () => K.layers.select(l.id));
      box.appendChild(row);
    });
  },

  renderLayerProps() {
    const l = K.layers.selected();
    const panel = K.$('#layerProps');
    if (!l) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    K.$('#lpName').value = l.name;
    K.$('#lpOpacity').value = l.opacity;
    K.$('#lpOpacityOut').textContent = (+l.opacity).toFixed(2);
    K.$('#lpBehind').classList.toggle('accent', !!l.behind);
    K.$('#lpX').value = l.x; K.$('#lpY').value = l.y;
    K.$('#lpScale').value = l.scale; K.$('#lpRot').value = l.rot;
    K.$('#lpW').value = l.w; K.$('#lpH').value = l.h;
    K.$('#lpSizeRow').classList.toggle('hidden', l.type === 'image' || l.type === 'pen' || l.type === 'text');
    K.$('#lpColor').value = l.color;
    K.$('#lpFill').checked = !!l.fill;
    K.$('#lpColorRow').classList.toggle('hidden', l.type === 'image' || l.type === 'video');
    K.$('#lpTextRow').classList.toggle('hidden', l.type !== 'text'); K.$('#lpText').value = l.text || '';
    K.$('#lpFontRow').classList.toggle('hidden', l.type !== 'text'); K.$('#lpFontSize').value = l.fontSize || 72;
    K.$('#lpVideoRow').classList.toggle('hidden', l.type !== 'video'); K.$('#lpVideoOffset').value = l.videoOffset || 0;
    K.$('#lpInvertRow').classList.toggle('hidden', l.type !== 'mask');
    K.$('#lpInvert').checked = !!l.invert;
    // keyframe list
    const list = K.$('#lpKeyList');
    list.innerHTML = '';
    if (!l.keys || !l.keys.length) list.textContent = 'No keys — static layer.';
    else {
      for (const k of l.keys) {
        const row = document.createElement('div');
        row.className = 'keyrow';
        const jump = document.createElement('button');
        jump.textContent = `◆ koma ${k.exp + 1}`;
        jump.style.color = 'var(--accent2)';
        jump.addEventListener('click', () => { K.playback.stop(); K.viewport.setExposure(k.exp); });
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Delete key';
        del.addEventListener('click', () => { K.layers.removeKey(k.exp); this.renderLayerProps(); });
        row.append(jump, del);
        list.appendChild(row);
      }
    }
  },

  /* ================= guides pane ================= */
  _guidesPane() {
    const g = K.viewport.guides;
    K.$('#selGrid').addEventListener('change', (e) => { g.grid = e.target.value; K.viewport.invalidate(); this.persistSettings(); });
    K.$('#chkCross').addEventListener('change', (e) => { g.cross = e.target.checked; K.viewport.invalidate(); this.persistSettings(); });
    K.$('#chkSafe').addEventListener('change', (e) => { g.safe = e.target.checked; K.viewport.invalidate(); this.persistSettings(); });
    K.$('#selMask').addEventListener('change', (e) => { g.mask = e.target.value; K.viewport.invalidate(); this.persistSettings(); });
    K.$('#inMaskA').addEventListener('input', (e) => { g.maskAlpha = +e.target.value; K.$('#outMaskA').textContent = e.target.value; K.viewport.invalidate(); this.persistSettings(); });
  },

  /* ================= cinematography pane ================= */
  _cinePane() {
    const bindCheck = (id, key) => K.$(id).addEventListener('change', (e) => {
      K.cine.settings[key] = e.target.checked; K.cine.apply(); this.persistSettings();
    });
    const bindRange = (id, out, key) => K.$(id).addEventListener('input', (e) => {
      K.cine.settings[key] = +e.target.value; K.$(out).textContent = e.target.value;
      K.cine.apply(); this.persistSettings();
    });
    bindCheck('#chkHistogram', 'histogram');
    bindCheck('#chkZebra', 'zebra');
    bindCheck('#chkPeaking', 'peaking');
    bindCheck('#chkChroma', 'chroma');
    bindRange('#inClipLevel', '#outClipLevel', 'clipLevel');
    bindRange('#inPeakThreshold', '#outPeakThreshold', 'peakThreshold');
    bindRange('#inChromaTolerance', '#outChromaTolerance', 'chromaTolerance');
    K.$('#inChromaColor').addEventListener('input', (e) => { K.cine.settings.chromaColor = e.target.value; K.cine.apply(); this.persistSettings(); });
    K.$('#selDesqueeze').addEventListener('change', (e) => { K.cine.settings.desqueeze = +e.target.value; K.cine.apply(); this.persistSettings(); });
  },

  /* ================= audio pane ================= */
  _audioPane() {
    K.$('#btnAudioLoad').addEventListener('click', () => K.$('#fileAudio').click());
    K.$('#fileAudio').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      for (const f of files) {
        try { await K.audio.load(f, f.name); }
        catch (err) { K.toast('Audio decode failed: ' + err.message, 'err'); }
      }
      if (files.length) K.toast(`${files.length} audio track${files.length === 1 ? '' : 's'} loaded`, 'ok');
      e.target.value = '';
    });
    K.$('#btnAudioClear').addEventListener('click', () => K.audio.removeSelected());
    K.$('#inAudioOffset').addEventListener('change', (e) => {
      K.audio.offsetFrames = parseInt(e.target.value, 10) || 0;
      K.audio._waveBase = null;
      K.project.saveSoon();
      this.redrawWave();
    });
    K.$('#chkAudioPlay').addEventListener('change', (e) => { K.audio.enabled = e.target.checked; this.persistSettings(); });
    K.$('#chkScrub').addEventListener('change', (e) => { K.audio.scrub = e.target.checked; this.persistSettings(); });
    K.$('#inVolume').addEventListener('input', (e) => { K.audio.setVolume(+e.target.value); this.persistSettings(); });
    K.$('#chkTrackMute').addEventListener('change', (e) => K.audio.setMuted(e.target.checked));
    K.$('#chkFaces').addEventListener('change', (e) => { K.faces.settings.enabled = e.target.checked; K.viewport.invalidate(); this.persistSettings(); });
    K.$('#btnFaceLoad').addEventListener('click', () => K.$('#fileFaces').click());
    K.$('#fileFaces').addEventListener('change', async (e) => {
      await K.faces.loadFiles(Array.from(e.target.files)); e.target.value = '';
      this.renderFaceSettings(); this.persistSettings();
    });
    K.$('#btnFaceGeneric').addEventListener('click', () => { K.faces.useGeneric(); this.renderFaceSettings(); this.persistSettings(); });
    const facePosition = () => {
      K.faces.settings.x = parseInt(K.$('#inFaceX').value, 10) || 0;
      K.faces.settings.y = parseInt(K.$('#inFaceY').value, 10) || 0;
      K.faces.settings.scale = K.clamp(parseInt(K.$('#inFaceScale').value, 10) || 100, 10, 500);
      K.viewport.invalidate(); this.persistSettings();
    };
    K.$('#inFaceX').addEventListener('change', facePosition); K.$('#inFaceY').addEventListener('change', facePosition); K.$('#inFaceScale').addEventListener('change', facePosition);
  },

  renderFaceSettings() {
    if (!K.$('#faceInfo')) return;
    const count = Object.keys(K.faces.settings.assets || {}).length;
    K.$('#chkFaces').checked = K.faces.settings.enabled;
    K.$('#inFaceX').value = K.faces.settings.x; K.$('#inFaceY').value = K.faces.settings.y; K.$('#inFaceScale').value = K.faces.settings.scale;
    K.$('#faceInfo').textContent = count ? `${count} custom phoneme image${count === 1 ? '' : 's'} loaded.` : 'Generic A/E/I/O/U/MBP/FV/L/WQ/rest mouth chart.';
  },

  /* ================= review pane ================= */
  _reviewPane() {
    K.$('#selPlaybackSpeed').addEventListener('change', (e) => { K.playback.speed = +e.target.value; this.persistSettings(); });
    K.$('#btnSetIn').addEventListener('click', () => { K.playback.inPoint = K.viewport.currentExposure(); if (K.playback.outPoint !== null && K.playback.outPoint < K.playback.inPoint) K.playback.outPoint = K.playback.inPoint; this.renderReviewSettings(); this.persistSettings(); });
    K.$('#btnSetOut').addEventListener('click', () => { K.playback.outPoint = K.viewport.currentExposure(); if (K.playback.inPoint !== null && K.playback.inPoint > K.playback.outPoint) K.playback.inPoint = K.playback.outPoint; this.renderReviewSettings(); this.persistSettings(); });
    K.$('#btnClearRange').addEventListener('click', () => { K.playback.inPoint = null; K.playback.outPoint = null; this.renderReviewSettings(); this.persistSettings(); });
    K.$('#selCompareTarget').addEventListener('change', (e) => { K.review.set({ target: e.target.value }); this.persistSettings(); });
    K.$('#selCompareMode').addEventListener('change', (e) => { K.review.set({ mode: e.target.value }); this.renderReviewSettings(); this.persistSettings(); });
    K.$('#btnCompareAB').addEventListener('click', () => { K.review.set({ showB: !K.review.showB }); this.renderReviewSettings(); });
    K.bus.on('popthrough:changed', ({ on }) => K.$('#compareInfo').textContent = on ? 'POP-THROUGH active — release P to return.' : 'Compare another edit or another take from this production shot.');
  },

  async renderReviewTargets() {
    const select = K.$('#selCompareTarget'); if (!select || !K.project.current) return;
    const previous = K.review.target; select.innerHTML = '<option value="">Choose source…</option>';
    for (const edit of K.frames.edits) if (edit.id !== K.frames.activeEditId) {
      const option = document.createElement('option'); option.value = `edit:${edit.id}`; option.textContent = `Edit · ${edit.name}`; select.appendChild(option);
    }
    const current = K.project.current;
    const projects = await K.project.listAll();
    for (const project of projects) if (project.id !== current.id && current.productionId && project.productionId === current.productionId && project.shotId === current.shotId) {
      const option = document.createElement('option'); option.value = `project:${project.id}`; option.textContent = `Take · ${project.name}`; select.appendChild(option);
    }
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    else { K.review.set({ target: '' }); select.value = ''; }
  },

  renderReviewSettings() {
    if (!K.$('#selPlaybackSpeed')) return;
    K.$('#selPlaybackSpeed').value = String(K.playback.speed);
    K.$('#reviewRangeInfo').textContent = K.playback.inPoint === null && K.playback.outPoint === null ? 'Full sequence' : `IN ${K.playback.inPoint === null ? 1 : K.playback.inPoint + 1} · OUT ${K.playback.outPoint === null ? K.frames.totalExposures() : K.playback.outPoint + 1}`;
    K.$('#selCompareMode').value = K.review.mode;
    K.$('#btnCompareAB').textContent = K.review.showB ? 'Show A' : 'Show B';
    K.$('#btnCompareAB').disabled = K.review.mode !== 'ab' || !K.review.target;
  },

  renderAudioTracks() {
    const box = K.$('#audioTrackList');
    if (!box) return;
    box.innerHTML = '';
    for (const track of K.audio.tracks) {
      const row = document.createElement('button'); row.type = 'button';
      row.className = 'audio-track-row' + (track.id === K.audio.selectedId ? ' sel' : '');
      row.textContent = `${track.muted ? 'M · ' : ''}${track.name} · ${track.offsetFrames >= 0 ? '+' : ''}${track.offsetFrames}f`;
      row.addEventListener('click', () => K.audio.select(track.id)); box.appendChild(row);
    }
    if (!K.audio.tracks.length) box.innerHTML = '<div class="dim small">No tracks.</div>';
    const selected = K.audio.selected();
    K.$('#btnAudioClear').classList.toggle('hidden', !selected);
    K.$('#inAudioOffset').disabled = !selected; K.$('#inVolume').disabled = !selected; K.$('#chkTrackMute').disabled = !selected;
    if (selected) {
      K.$('#audioInfo').textContent = `${K.audio.tracks.length} track${K.audio.tracks.length === 1 ? '' : 's'} · selected ${selected.name} · ${selected.buffer.duration.toFixed(1)}s`;
      K.$('#inAudioOffset').value = selected.offsetFrames; K.$('#inVolume').value = selected.volume; K.$('#chkTrackMute').checked = selected.muted;
      K.$('#waveform').classList.remove('hidden');
    }
  },

  /* ================= export pane ================= */
  _exportPane() {
    const selMime = K.$('#selVidMime');
    const mimes = K.exporter.supportedMimes();
    if (mimes.length === 0) {
      selMime.innerHTML = '<option>Not supported in this browser</option>';
      K.$('#btnExportVideo').disabled = true;
    } else {
      mimes.forEach(([m, label]) => {
        const o = document.createElement('option');
        o.value = m; o.textContent = label;
        selMime.appendChild(o);
      });
    }
    K.$('#btnExportVideo').addEventListener('click', async () => {
      const prog = K.$('#exportProg');
      try {
        await K.exporter.exportVideo({
          mime: selMime.value,
          bitrate: parseInt(K.$('#selVidBr').value, 10),
          withAudio: K.$('#chkVidAudio').checked,
          onProgress: (done, total) => {
            prog.textContent = total ? `Rendering ${done}/${total} (real-time)…` : '';
          },
        });
      } catch (e) { K.toast('Export failed: ' + e.message, 'err', 4000); prog.textContent = ''; }
    });
    K.$('#btnExportSeq').addEventListener('click', () =>
      K.exporter.exportSequence({ expandHolds: K.$('#chkSeqHolds').checked })
        .catch((e) => K.toast('Export failed: ' + e.message, 'err')));
    K.$('#btnExportProj').addEventListener('click', () =>
      K.exporter.exportProject().catch((e) => K.toast('Backup failed: ' + e.message, 'err')));
    K.$('#btnExportCsv').addEventListener('click', () => K.exporter.exportEditListCsv());
    for (const [id, kind] of [['#btnExportEdl', 'edl'], ['#btnExportFcpxml', 'fcpxml'], ['#btnExportAaf', 'aaf'], ['#btnExportRecipe', 'recipe']]) {
      K.$(id).addEventListener('click', () => K.editorial.download(kind)
        .catch((e) => K.toast('Editorial export failed: ' + e.message, 'err', 5000)));
    }
    K.$('#btnWriteEditorial').addEventListener('click', async () => {
      const info = K.$('#editorialInfo');
      try {
        info.textContent = 'Writing editorial hand-off package…';
        const pack = await K.editorial.writePackage();
        info.textContent = `${pack.model.events.length} event(s), ${pack.model.totalFrames} frame(s) written to the take folder.`;
      } catch (e) {
        info.textContent = 'Package was not written.';
        K.toast('Editorial package failed: ' + e.message, 'err', 5000);
      }
    });
    K.$('#btnImportProj').addEventListener('click', () => K.$('#fileProject').click());
    K.$('#fileProject').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) {
        try { await K.exporter.importProject(f); }
        catch (err) { K.toast('Import failed: ' + err.message, 'err', 4000); }
      }
      e.target.value = '';
    });

    K.$('#btnImportImgs').addEventListener('click', () => K.$('#fileImages').click());
    K.$('#fileImages').addEventListener('change', async (e) => {
      await this.importImageFiles(Array.from(e.target.files));
      e.target.value = '';
    });
    K.$('#btnReverse').addEventListener('click', () => K.frames.reverse());
    K.$('#btnPingPong').addEventListener('click', () => {
      if (K.frames.count() < 2) { K.toast('Need at least 2 frames'); return; }
      K.frames.pingPong();
    });
  },

  async importImageFiles(files) {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    imgs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    K.status(`Importing ${imgs.length} images…`);
    for (const f of imgs) {
      try {
        const bmp = await createImageBitmap(f);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        const blob = f.type === 'image/jpeg' ? f : await K.canvasToBlob(c, 'image/jpeg', K.camera.jpegQuality);
        await K.frames.add({ blob, w: c.width, h: c.height }, { hold: this.captureHold });
      } catch (e) { console.warn('skip', f.name, e); }
    }
    K.status('');
    K.toast(`Imported ${imgs.length} frames`, 'ok');
    K.timeline.scrollToEnd();
  },

  /* ================= edits (alt versions) ================= */
  refreshEditSelect() {
    const sel = K.$('#selEdit');
    sel.innerHTML = '';
    for (const ed of K.frames.edits) {
      const o = document.createElement('option');
      o.value = ed.id;
      o.textContent = ed.name;
      sel.appendChild(o);
    }
    sel.value = K.frames.activeEditId;
  },

  newAltEdit() {
    K.frames.newAltEdit('Alt ' + K.frames.edits.length);
    K.toast('Now editing a copy — the original edit is untouched', 'ok');
  },

  /* ================= captures bin ================= */
  openBin() {
    const grid = K.$('#binGrid');
    grid.innerHTML = '';
    const fs = K.frames;
    const unusedAnywhere = new Set(fs.unusedCaptureIds());
    fs.captures.forEach((c, i) => {
      const item = document.createElement('div');
      item.className = 'bin-item' + (unusedAnywhere.has(c.id) ? ' unused' : '');
      const img = document.createElement('img');
      img.src = c.thumb;
      item.appendChild(img);
      const n = document.createElement('span');
      n.className = 'bi-n';
      n.textContent = i + 1;
      item.appendChild(n);
      const flags = document.createElement('div');
      flags.className = 'bi-flags';
      if (fs.usedInActive(c.id)) flags.innerHTML += '<span class="inedit">IN EDIT</span>';
      if (c.isTest) flags.innerHTML += '<span class="testf">TEST</span>';
      if (c.raw) flags.innerHTML += '<span class="rawf" title="' + c.raw + '">RAW</span>';
      if (c.passes?.length) flags.innerHTML += '<span class="passf">P×' + c.passes.length + '</span>';
      item.appendChild(flags);
      item.title = new Date(c.capturedAt).toLocaleString() + (c.raw ? '\n' + c.raw : '');
      item.addEventListener('click', () => {
        const at = K.viewport.mode === 'review' ? K.viewport.reviewIdx + 1 : null;
        fs.insertCapture(c.id, at);
        K.toast('Inserted into edit', 'ok');
        this.openBin(); // refresh flags
      });
      grid.appendChild(item);
    });
    if (!fs.captures.length) grid.innerHTML = '<div class="dim small">No captures yet.</div>';
    this.showModal('binModal');
  },

  /* ================= link pane ================= */
  _linkPane() {
    K.$('#btnBridge').addEventListener('click', () => {
      if (K.bridge.connected) K.bridge.disconnect();
      else K.bridge.connect(K.$('#inBridgeUrl').value.trim());
    });
    K.$('#chkBridgeAuto').addEventListener('change', (e) => { K.bridge.auto = e.target.checked; });

    /* tether (in Camera pane, wired here for proximity to bridge logic) */
    K.$('#inTetherToken').value = K.tether.restorePairingToken();
    K.$('#btnTether').addEventListener('click', () => {
      if (K.tether.connected || K.tether.connecting) K.tether.disconnect();
      else K.tether.connect(K.$('#inTetherUrl').value.trim(), K.$('#inTetherToken').value);
    });
    K.$('#inTetherToken').addEventListener('change', (event) => K.tether.setPairingToken(event.target.value));
    K.$('#btnForgetTetherToken').addEventListener('click', () => {
      K.tether.disconnect();
      K.tether.setPairingToken('');
      K.toast('Companion pairing key forgotten for this tab', 'ok');
    });
    K.$('#chkTetherTrigger').addEventListener('change', (e) => { K.tether.trigger = e.target.checked; });
    K.$('#chkTetherJpeg').addEventListener('change', (e) => { K.tether.useJpeg = e.target.checked; });
    K.$('#chkTetherPasses').addEventListener('change', (e) => { K.tether.passesEnabled = e.target.checked; this.persistSettings(); });
    K.$('#btnAddPass').addEventListener('click', () => K.tether.addPass());
    K.$('#btnBracket').addEventListener('click', () => K.tether.makeBracket());
  },

  /* ================= transport ================= */
  _transport() {
    K.$('#btnCapture').addEventListener('click', () => this.capture());
    K.$('#btnTestCapture').addEventListener('click', () => this.capture({ test: true }));
    K.$('#btnPlay').addEventListener('click', () => K.playback.toggle({ fromStart: K.viewport.mode === 'live' }));
    K.$('#btnStepBack').addEventListener('click', () => this.step(-1));
    K.$('#btnStepFwd').addEventListener('click', () => this.step(1));
    K.$('#btnFirst').addEventListener('click', () => this.goFirst());
    K.$('#btnLast').addEventListener('click', () => this.goLast());
    K.$('#btnLive').addEventListener('click', () => this.toggleLive());
    K.$('#btnLoop').addEventListener('click', () => this.toggleLoop());
    K.$('#btnShort').addEventListener('click', () => K.playback.play({ short: true }));
    K.$('#btnDelete').addEventListener('click', () => this.deleteCurrent());
    K.$('#btnUndo').addEventListener('click', () => K.frames.undo());
    K.$('#btnRedo').addEventListener('click', () => K.frames.redo());
    K.$('#btnBin').addEventListener('click', () => this.openBin());
    K.$('#btnPurge').addEventListener('click', async () => {
      const n = K.frames.unusedCaptureIds().length;
      if (!n) { K.toast('No unused captures'); return; }
      if (confirm(`Permanently delete ${n} capture(s) not used by ANY edit? RAW files on disk are not touched.`)) {
        const removed = await K.frames.purgeUnused();
        K.toast(`Deleted ${removed} captures`, 'ok');
        this.openBin();
      }
    });
    K.$('#inCaptureHold').addEventListener('change', (e) => {
      this.captureHold = K.clamp(parseInt(e.target.value, 10) || 1, 1, 12);
      e.target.value = this.captureHold;
      this.persistSettings();
    });
  },

  /* ================= topbar ================= */
  _topbar() {
    K.$('#btnMonitor').addEventListener('click', () => {
      try { K.ecosystem.openMonitor(); }
      catch (e) { K.toast(e.message, 'err', 5000); }
    });
    K.$('#inFps').addEventListener('change', (e) => {
      const fps = K.clamp(parseInt(e.target.value, 10) || 12, 1, 60);
      e.target.value = fps;
      K.project.current.fps = fps;
      K.audio._waveBase = null;
      K.project.saveSoon();
      K.timeline.render();      // ruler second-marks depend on fps
      this.updateCounters();
      if (K.xsheet.open) K.xsheet.render();
    });
    K.$('#btnProject').addEventListener('click', () => this.openProjectModal());
    K.$('#selProjectStartMode').value = K.project.startMode();
    K.$('#selProjectStartMode').addEventListener('change', (event) => {
      const mode = K.project.setStartMode(event.target.value);
      K.toast(mode === 'resume-last' ? 'This device will reopen the last project' : 'A closed browser session will start a new shoot', 'ok');
    });
    K.$('#btnProjectStorage').addEventListener('click', () => { this.renderLocalFolder(); this.showModal('storageChoiceModal'); });
    K.$('#btnHelp').addEventListener('click', () => this.showModal('helpModal'));
    K.bus.on('project:renamed', ({ name }) => { K.$('#projectName').textContent = name; K.$('#focusProject').textContent = name; });

    K.$('#selEdit').addEventListener('change', (e) => {
      K.playback.stop();
      K.frames.switchEdit(e.target.value);
    });
    K.$('#btnAltEdit').addEventListener('click', () => this.newAltEdit());
    K.$('#btnAsShot').addEventListener('click', () => {
      if (confirm('Rebuild this edit exactly as shot (take captures, capture order, shot holds)?\nTest shots stay in the bin. Use +ALT first if you want to keep the current cut.')) {
        K.playback.stop();
        K.frames.resetAsShot();
      }
    });
  },

  /* ================= project modal ================= */
  async openProjectModal() {
    const list = K.$('#projectList');
    list.innerHTML = '';
    const projects = await K.project.listAll();
    for (const p of projects) {
      const active = p.edits && p.edits.find((e) => e.id === p.activeEditId);
      const recs = active ? active.items.length : (p.frameOrder ? p.frameOrder.length : 0);
      const editCount = p.edits ? p.edits.length : 1;
      const item = document.createElement('div');
      item.className = 'proj-item';
      item.innerHTML = `
        <div>
          <div class="pi-name">${this._esc(p.name)}${p.id === K.project.current.id ? ' <span class="dim">(open)</span>' : ''}</div>
          <div class="pi-meta">${recs} frames · ${editCount} edit${editCount > 1 ? 's' : ''} · ${p.fps} fps · ${new Date(p.updatedAt).toLocaleString()}</div>
        </div>`;
      const btnOpen = document.createElement('button');
      btnOpen.className = 'btn project-open';
      btnOpen.textContent = p.id === K.project.current.id ? 'Open' : 'Open project';
      btnOpen.disabled = p.id === K.project.current.id;
      btnOpen.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (p.id !== K.project.current.id) await K.project.open(p.id);
        this.hideModals();
      });
      const btnRen = document.createElement('button');
      btnRen.className = 'icon-btn'; btnRen.textContent = '✏️'; btnRen.title = 'Rename';
      btnRen.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = prompt('Project name:', p.name);
        if (name) { await K.project.rename(p.id, name.trim()); this.openProjectModal(); }
      });
      const btnDel = document.createElement('button');
      btnDel.className = 'icon-btn'; btnDel.textContent = '🗑'; btnDel.title = 'Delete';
      btnDel.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${p.name}" and all its frames? This cannot be undone.`)) {
          await K.project.remove(p.id);
          this.openProjectModal();
        }
      });
      item.appendChild(btnOpen);
      item.appendChild(btnRen);
      item.appendChild(btnDel);
      list.appendChild(item);
    }
    this.showModal('projectModal');
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },

  /* ================= modals ================= */
  _modals() {
    K.$('#btnNewProject').addEventListener('click', async () => {
      const name = prompt('New project name:', 'Scene ' + new Date().toLocaleDateString());
      if (name === null) return;
      await K.project.create(name.trim() || 'Untitled');
      this.hideModals();
    });
    K.$('#btnMoreClose').addEventListener('click', () => this.hideModals());
    K.$('#btnQuickCameraClose').addEventListener('click', () => this.hideModals());
    K.$('#btnStorageClose').addEventListener('click', () => this.hideModals());
    K.$('#btnMoreCamera').addEventListener('click', () => this.openQuickCamera());
    K.$('#btnMoreStorage').addEventListener('click', () => { this.renderLocalFolder(); this.showModal('storageChoiceModal'); });
    K.$('#btnQuickCameraStart').addEventListener('click', async () => {
      const started = await this.startCameraFrom(K.$('#selQuickCamera').value, K.$('#selQuickRes').value);
      if (started) this.hideModals();
    });
    K.$('#btnQuickCameraStop').addEventListener('click', () => K.camera.stop());
    K.$('#selQuickCamera').addEventListener('change', () => this.renderQuickCameraState());
    K.$('#btnStorageChoose').addEventListener('click', async () => {
      try {
        if (K.localFolder.handle && K.localFolder.permission !== 'granted') await K.localFolder.reconnect();
        else await K.localFolder.choose();
        K.toast('Local capture folder connected', 'ok');
        this.renderLocalFolder();
      } catch (error) { if (error.name !== 'AbortError') K.toast(error.message, 'err', 5000); }
    });
    K.$('#btnStorageDisconnect').addEventListener('click', () => { K.localFolder.forget(); this.renderLocalFolder(); });
    K.$('#btnStorageShare').addEventListener('click', async () => {
      try { await K.localFolder.shareBackup(); K.toast('Project backup prepared', 'ok'); }
      catch (error) { if (error.name !== 'AbortError') K.toast(error.message, 'err', 5000); }
    });
    const moreAction = (selector, action, { close = true } = {}) => {
      K.$(selector).addEventListener('click', () => {
        action();
        if (close) this.hideModals();
      });
    };
    moreAction('#btnMoreFirst', () => this.goFirst());
    moreAction('#btnMoreLast', () => this.goLast());
    moreAction('#btnMoreLoop', () => this.toggleLoop());
    moreAction('#btnMoreShort', () => K.playback.play({ short: true }));
    moreAction('#btnMoreTest', () => this.capture({ test: true }));
    moreAction('#btnMoreDelete', () => this.deleteCurrent());
    moreAction('#btnMoreUndo', () => K.frames.undo());
    moreAction('#btnMoreRedo', () => K.frames.redo());
    moreAction('#btnMoreBin', () => this.openBin(), { close: false });
    K.$('#inMoreCaptureHold').addEventListener('change', (event) => {
      this.captureHold = K.clamp(parseInt(event.target.value, 10) || 1, 1, 12);
      event.target.value = this.captureHold;
      K.$('#inCaptureHold').value = this.captureHold;
      this.persistSettings();
    });
    K.$('#modalBack').addEventListener('click', (e) => {
      if (e.target.id === 'modalBack') this.hideModals();
    });
  },

  showModal(id) {
    K.$('#modalBack').classList.remove('hidden');
    K.$$('.modal').forEach((m) => m.classList.toggle('hidden', m.id !== id));
  },

  hideModals() {
    K.$('#modalBack').classList.add('hidden');
    K.$$('.modal').forEach((m) => m.classList.add('hidden'));
    K.xsheet.open = false;
  },

  /* ================= drag & drop import ================= */
  _dragDrop() {
    const wrap = K.$('#viewportWrap');
    wrap.addEventListener('dragover', (e) => { e.preventDefault(); });
    wrap.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      const audio = files.find((f) => f.type.startsWith('audio/'));
      if (audio) { await K.audio.load(audio, audio.name).catch((err) => K.toast(err.message, 'err')); }
      await this.importImageFiles(files);
    });
  },

  /* ================= settings persistence ================= */
  persistSettings: null, // debounced, assigned in init

  _persistSettingsNow() {
    const p = K.project.current;
    if (!p) return;
    p.settings = {
      onion: { ...K.viewport.onion },
      guides: { ...K.viewport.guides },
      captureHold: this.captureHold,
      blackout: this.blackout,
      jpegQuality: K.camera.jpegQuality,
      resPreset: K.$('#selRes').value,
      cameraId: K.$('#selCamera').value || '',
      mirrorH: K.camera.mirrorH, mirrorV: K.camera.mirrorV, rot180: K.camera.rot180,
      photoMode: K.camera.photoMode,
      loop: K.playback.loop,
      tetherConfigs: { ...K.tether.selectedConfigs },
      tetherPasses: { enabled: K.tether.passesEnabled, presets: JSON.parse(JSON.stringify(K.tether.passPresets)) },
      lapseRamp: {
        enabled: K.$('#chkLapseRamp').checked,
        path: K.$('#selLapseRampPath').value,
        endValue: K.$('#selLapseRampEnd').value,
        shots: K.clamp(parseInt(K.$('#inLapseRampShots').value, 10) || 24, 2, 9999),
      },
      audio: { enabled: K.audio.enabled, scrub: K.audio.scrub, volume: K.audio.volume },
      cine: { ...K.cine.settings },
      faces: JSON.parse(JSON.stringify(K.faces.settings)),
      review: { speed: K.playback.speed, inPoint: K.playback.inPoint, outPoint: K.playback.outPoint, compareMode: K.review.mode, compareTarget: K.review.target },
    };
    K.project.saveSoon();
  },

  applyProjectSettings() {
    const p = K.project.current;
    const s = p.settings || {};
    K.$('#projectName').textContent = p.name;
    K.$('#inFps').value = p.fps;

    Object.assign(K.viewport.onion, s.onion || {});
    Object.assign(K.viewport.guides, s.guides || {});
    K.cine.apply(s.cine || {});
    K.faces.apply(s.faces || {}).catch((e) => console.warn('Face set:', e.message));
    const review = s.review || {};
    K.playback.speed = [0.25, 0.5, 1, 2].includes(+review.speed) ? +review.speed : 1;
    K.playback.inPoint = Number.isInteger(review.inPoint) ? review.inPoint : null;
    K.playback.outPoint = Number.isInteger(review.outPoint) ? review.outPoint : null;
    K.review.set({ mode: review.compareMode || 'off', target: review.compareTarget || '', showB: false });
    this.captureHold = s.captureHold || 1;
    this.blackout = s.blackout !== false;
    K.camera.jpegQuality = s.jpegQuality || 0.92;
    K.camera.mirrorH = !!s.mirrorH; K.camera.mirrorV = !!s.mirrorV; K.camera.rot180 = !!s.rot180;
    K.camera.photoMode = !!s.photoMode;
    K.playback.loop = !!s.loop;
    K.tether.selectedConfigs = { ...(s.tetherConfigs || {}) };
    K.tether.passesEnabled = !!s.tetherPasses?.enabled;
    K.tether.passPresets = JSON.parse(JSON.stringify(s.tetherPasses?.presets || []));
    if (s.audio) {
      K.audio.enabled = s.audio.enabled !== false;
      K.audio.scrub = s.audio.scrub !== false;
      K.audio.setVolume(s.audio.volume !== undefined ? s.audio.volume : 1);
    }

    // reflect into inputs
    const o = K.viewport.onion, g = K.viewport.guides;
    K.$('#chkOnion').checked = o.on;
    K.$('#inOnionN').value = o.frames; K.$('#outOnionN').textContent = o.frames;
    K.$('#inOnionA').value = o.alpha; K.$('#outOnionA').textContent = o.alpha;
    K.$('#selOnionMode').value = o.mode;
    K.$('#chkOnionNext').checked = o.next;
    K.$('#inOnionX').value = o.offsetX || 0; K.$('#inOnionY').value = o.offsetY || 0;
    K.$('#selGrid').value = g.grid;
    K.$('#chkCross').checked = g.cross;
    K.$('#chkSafe').checked = g.safe;
    K.$('#selMask').value = g.mask;
    K.$('#inMaskA').value = g.maskAlpha; K.$('#outMaskA').textContent = g.maskAlpha;
    K.$('#inCaptureHold').value = this.captureHold;
    K.$('#inMoreCaptureHold').value = this.captureHold;
    K.$('#inJpegQ').value = K.camera.jpegQuality; K.$('#outJpegQ').textContent = K.camera.jpegQuality;
    K.$('#chkMirrorH').checked = K.camera.mirrorH;
    K.$('#chkMirrorV').checked = K.camera.mirrorV;
    K.$('#chkRot180').checked = K.camera.rot180;
    K.$('#chkPhotoMode').checked = K.camera.photoMode;
    K.$('#chkBlackout').checked = this.blackout;
    K.$('#chkTetherPasses').checked = K.tether.passesEnabled;
    K.tether.renderPassControls();
    K.tether.renderFocusControls();
    if (K.tether.connected) K.tether.refreshConfigs();
    const ramp = s.lapseRamp || {};
    K.$('#chkLapseRamp').checked = !!ramp.enabled;
    K.$('#lapseRampControls').classList.toggle('hidden', !ramp.enabled);
    this.renderLapseRampControls();
    if (ramp.path && K.tether.configs.some((c) => c.path === ramp.path)) K.$('#selLapseRampPath').value = ramp.path;
    this.renderLapseRampControls();
    if (ramp.endValue && [...K.$('#selLapseRampEnd').options].some((o) => o.value === ramp.endValue)) K.$('#selLapseRampEnd').value = ramp.endValue;
    K.$('#inLapseRampShots').value = ramp.shots || 24;
    if (s.resPreset) K.$('#selRes').value = s.resPreset;
    if (K.$('#selQuickRes')) K.$('#selQuickRes').value = s.resPreset || K.$('#selRes').value;
    K.$('#selProjectStartMode').value = K.project.startMode();
    K.$('#btnLoop').classList.toggle('on', K.playback.loop);
    K.$('#btnMoreLoop').classList.toggle('on', K.playback.loop);
    K.$('#inAudioOffset').value = K.audio.offsetFrames;
    K.$('#chkAudioPlay').checked = K.audio.enabled;
    K.$('#chkScrub').checked = K.audio.scrub;
    K.$('#inVolume').value = K.audio.volume;
    K.$('#chkHistogram').checked = K.cine.settings.histogram;
    K.$('#chkZebra').checked = K.cine.settings.zebra;
    K.$('#inClipLevel').value = K.cine.settings.clipLevel; K.$('#outClipLevel').textContent = K.cine.settings.clipLevel;
    K.$('#chkPeaking').checked = K.cine.settings.peaking;
    K.$('#inPeakThreshold').value = K.cine.settings.peakThreshold; K.$('#outPeakThreshold').textContent = K.cine.settings.peakThreshold;
    K.$('#chkChroma').checked = K.cine.settings.chroma;
    K.$('#inChromaColor').value = K.cine.settings.chromaColor;
    K.$('#inChromaTolerance').value = K.cine.settings.chromaTolerance; K.$('#outChromaTolerance').textContent = K.cine.settings.chromaTolerance;
    K.$('#selDesqueeze').value = String(K.cine.settings.desqueeze);
    this.renderAudioTracks();
    this.renderFaceSettings();
    this.renderReviewSettings();
    this.renderReviewTargets();

    K.viewport.setMode(K.frames.count() && !K.camera.running ? 'review' : 'live', Math.max(0, K.frames.count() - 1));
    this.renderLayerList();
    this.renderLayerProps();
    this.updateCounters();
    this.updateModeUI();
  },
};
K.ui.persistSettings = K.debounce(() => K.ui._persistSettingsNow(), 300);
