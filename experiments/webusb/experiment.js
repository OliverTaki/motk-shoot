'use strict';

const $ = (selector) => document.querySelector(selector);
const buttons = ['#btnOps', '#btnConfig', '#btnPreview', '#btnCapture'];
let camera = null;
let previewUrl = '';
let captureUrl = '';

function setStatus(message, error = false) {
  const el = $('#status');
  el.textContent = message;
  el.style.color = error ? '#ff9d90' : '';
}

function setConnected(connected) {
  $('#btnConnect').disabled = connected || !ready();
  $('#btnDisconnect').disabled = !connected;
  buttons.forEach((selector) => { $(selector).disabled = !connected; });
}

function ready() {
  return !!navigator.usb && window.isSecureContext && window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
}

function renderChecks() {
  const checks = [
    ['Secure context', window.isSecureContext, window.location.protocol + '//' + window.location.host],
    ['WebUSB API', !!navigator.usb, navigator.usb ? 'available' : 'not exposed by this browser'],
    ['Cross-origin isolated', window.crossOriginIsolated, window.crossOriginIsolated ? 'COOP/COEP active' : 'start the experiment server'],
    ['SharedArrayBuffer', typeof SharedArrayBuffer !== 'undefined', typeof SharedArrayBuffer !== 'undefined' ? 'available' : 'blocked'],
  ];
  const box = $('#checks');
  box.innerHTML = '';
  for (const [name, ok, detail] of checks) {
    const item = document.createElement('div');
    item.className = 'check' + (ok ? ' ok' : '');
    item.textContent = `${ok ? '✓' : '×'} ${name}: ${detail}`;
    box.appendChild(item);
  }
  const isWindows = /Windows/i.test(navigator.userAgent);
  $('#platformHelp').textContent = isWindows
    ? 'Windows detected: WebUSB needs a WinUSB-bound camera interface. Prefer WSL2 + the tether agent for production.'
    : 'Put the camera in PTP/Camera Control mode and close other applications that own it.';
  setConnected(false);
  if (!ready()) setStatus('Environment is not ready. Use the provided experiment server in Chrome or Edge.', true);
}

function errorMessage(error) {
  if (error?.name === 'NotFoundError') return 'No camera selected.';
  if (error?.name === 'SecurityError') return 'WebUSB access was blocked. Check HTTPS/localhost and browser policy.';
  if (error?.name === 'NetworkError') return 'The camera interface could not be claimed. Close camera software and check the USB driver.';
  return error?.message || String(error);
}

async function connect() {
  if (!ready()) return;
  $('#btnConnect').disabled = true;
  setStatus('Waiting for camera selection…');
  try {
    const { Camera } = await import('./vendor/web-gphoto2/build/camera.js');
    await Camera.showPicker();
    camera = new Camera();
    setStatus('Loading libgphoto2 WebAssembly and opening camera…');
    await camera.connect();
    const permitted = await navigator.usb.getDevices();
    const device = permitted[permitted.length - 1];
    $('#cameraInfo').textContent = device
      ? `${device.manufacturerName || 'Unknown maker'} ${device.productName || 'PTP camera'} · VID ${device.vendorId.toString(16).padStart(4, '0')} · PID ${device.productId.toString(16).padStart(4, '0')}`
      : 'PTP camera connected through libgphoto2';
    setConnected(true);
    setStatus('Connected. Start with read-only diagnosis.');
    $('#output').textContent = 'Camera connected.';
  } catch (error) {
    camera = null;
    setConnected(false);
    setStatus(errorMessage(error), true);
  }
}

async function disconnect() {
  try { await camera?.disconnect(); } catch { /* best effort */ }
  camera = null;
  setConnected(false);
  $('#cameraInfo').textContent = '';
  setStatus('Disconnected');
}

async function run(label, action) {
  if (!camera) return;
  buttons.forEach((selector) => { $(selector).disabled = true; });
  setStatus(label + '…');
  try {
    await action();
    setStatus(label + ' complete');
  } catch (error) {
    setStatus(errorMessage(error), true);
  } finally {
    if (camera) buttons.forEach((selector) => { $(selector).disabled = false; });
  }
}

$('#btnConnect').addEventListener('click', connect);
$('#btnDisconnect').addEventListener('click', disconnect);
$('#btnOps').addEventListener('click', () => run('Reading operations', async () => {
  $('#output').textContent = JSON.stringify(await camera.getSupportedOps(), null, 2);
}));
$('#btnConfig').addEventListener('click', () => run('Reading settings', async () => {
  $('#output').textContent = JSON.stringify(await camera.getConfig(), null, 2);
}));
$('#btnPreview').addEventListener('click', () => run('Capturing preview', async () => {
  const blob = await camera.capturePreviewAsBlob();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  $('#preview').src = previewUrl;
  $('#preview').classList.remove('hidden');
  $('#output').textContent = `Preview: ${blob.type || 'image'} · ${blob.size.toLocaleString()} bytes`;
}));
$('#btnCapture').addEventListener('click', () => run('Capturing full image', async () => {
  const file = await camera.captureImageAsFile();
  if (captureUrl) URL.revokeObjectURL(captureUrl);
  captureUrl = URL.createObjectURL(file);
  const link = $('#download');
  link.href = captureUrl;
  link.download = file.name || 'webusb-capture';
  link.textContent = `Save ${link.download} (${file.size.toLocaleString()} bytes)`;
  link.classList.remove('hidden');
  $('#output').textContent = `Captured ${link.download}\nType: ${file.type || 'unknown'}\nSize: ${file.size.toLocaleString()} bytes`;
}));

if (navigator.usb) navigator.usb.addEventListener('disconnect', () => disconnect());
window.addEventListener('beforeunload', () => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (captureUrl) URL.revokeObjectURL(captureUrl);
  camera?.disconnect();
});

renderChecks();

if (new URLSearchParams(location.search).get('selftest') === '1') {
  Promise.all([
    import('./vendor/web-gphoto2/build/camera.js'),
    import('./vendor/web-gphoto2/build/libapi.mjs'),
  ]).then(async ([{ Camera }, { default: initModule }]) => {
    if (typeof Camera !== 'function') throw new Error('Camera export missing');
    const module = await initModule();
    if (typeof module.Context !== 'function') throw new Error('libgphoto2 context export missing');
    document.documentElement.dataset.runtimeSelftest = 'passed';
    setStatus('WebAssembly runtime initialized; hardware permission was not requested.');
  }).catch((error) => {
    document.documentElement.dataset.runtimeSelftest = 'failed';
    setStatus('Runtime module failed: ' + errorMessage(error), true);
  });
}
