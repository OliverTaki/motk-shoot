/* MOTK Shoot — second-display video assist and read-only LAN observer mode. */
'use strict';
K.ecosystem = {
  monitorWindow: null,
  _publishBusy: false,
  _lastPublish: 0,

  isObserver() {
    const value = new URLSearchParams(location.search).get('observer');
    return value === '1' || value === 'true';
  },

  openMonitor() {
    if (this.monitorWindow && !this.monitorWindow.closed) {
      this.monitorWindow.focus();
      return this.monitorWindow;
    }
    this.monitorWindow = window.open('monitor.html', 'motkshoot-monitor', 'popup=yes,width=1280,height=720');
    if (!this.monitorWindow) throw new Error('The browser blocked the monitor window. Allow pop-ups for this site.');
    return this.monitorWindow;
  },

  publishViewport(canvas) {
    const now = Date.now();
    if (this.isObserver() || this._publishBusy || now - this._lastPublish < 200) return;
    if (!K.tether?.connected || !K.tether.publishObserver || !canvas.width || !canvas.height) return;
    this._publishBusy = true;
    this._lastPublish = now;
    canvas.toBlob(async (blob) => {
      try {
        if (!blob) return;
        const dataUrl = await K.blobToDataURL(blob);
        const state = window.motkshoot?.state?.() || {};
        state.project = K.project.current ? { name: K.project.current.name, fps: K.project.current.fps } : null;
        state.timecode = K.$('#timecode')?.textContent || '';
        state.edit = K.frames.activeEdit?.().name || '';
        K.tether.publishObserver(dataUrl.slice(dataUrl.indexOf(',') + 1), state);
      } catch (error) {
        console.warn('Observer preview:', error.message);
      } finally {
        this._publishBusy = false;
      }
    }, 'image/jpeg', 0.72);
  },

  initObserver() {
    document.documentElement.classList.add('observer-mode');
    document.body.innerHTML = `
      <main id="observerApp" aria-label="MOTK Shoot observer">
        <canvas id="observerCanvas"></canvas>
        <div id="observerTop"><strong>MOTK Shoot Observer</strong><span id="observerStatus">connecting…</span></div>
        <div id="observerBottom"><span id="observerProject">Waiting for the shooting station</span><span id="observerState"></span></div>
      </main>`;
    const canvas = document.querySelector('#observerCanvas');
    const ctx = canvas.getContext('2d');
    const status = document.querySelector('#observerStatus');
    const project = document.querySelector('#observerProject');
    const stateLine = document.querySelector('#observerState');
    let bitmap = null;
    const resize = () => {
      canvas.width = Math.max(1, innerWidth * devicePixelRatio);
      canvas.height = Math.max(1, innerHeight * devicePixelRatio);
      draw();
    };
    const draw = () => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!bitmap) return;
      const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const w = bitmap.width * scale, h = bitmap.height * scale;
      ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    addEventListener('resize', resize); resize();
    const params = new URLSearchParams(location.search);
    const defaultProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const endpoint = params.get('agent') || `${defaultProtocol}//${location.hostname}:${location.port || '8793'}`;
    const connect = () => {
      let socket;
      try { socket = new WebSocket(endpoint); }
      catch { status.textContent = 'invalid agent URL'; return; }
      socket.onopen = () => { status.textContent = 'connected · read only'; socket.send(JSON.stringify({ type: 'observer.subscribe' })); };
      socket.onclose = () => { status.textContent = 'reconnecting…'; setTimeout(connect, 2000); };
      socket.onerror = () => { status.textContent = 'connection error'; };
      socket.onmessage = async (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type !== 'observer.update') return;
        const current = message.state || {};
        project.textContent = current.project?.name || 'Untitled production';
        stateLine.textContent = `${current.edit || ''} · ${current.frames || 0} frames · ${current.timecode || ''}`;
        if (!message.jpeg) return;
        try {
          const response = await fetch(`data:image/jpeg;base64,${message.jpeg}`);
          const next = await createImageBitmap(await response.blob());
          if (bitmap) bitmap.close();
          bitmap = next; draw();
        } catch { status.textContent = 'preview decode error'; }
      };
    };
    connect();
  },
};

