const $ = id => document.getElementById(id);
const KEY = new URLSearchParams(location.search).get('key') || '';
const QUALITY = {
  '480':  { w: 854,  h: 480,  fps: 30, br: 1000000 },
  '720':  { w: 1280, h: 720,  fps: 30, br: 2500000 },
  '1080': { w: 1920, h: 1080, fps: 30, br: 4500000 },
};
let cfg = { cam: '', quality: '720', mic: true, mirror: false, zoom: 1, x: 0, y: 0 };
try { Object.assign(cfg, JSON.parse(localStorage.getItem('rostocam') || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem('rostocam', JSON.stringify(cfg)); } catch (e) {} };

let wakeLock = null;
let stream = null, ws = null, iceServers = [], paused = false;
const pcs = {}, viewers = new Set();
let queue = Promise.resolve();

const send = o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
const setStatus = t => { $('status').textContent = t; };
const refreshStatus = () => setStatus(`${stream ? 'Câmera ligada' : 'Câmera desligada'} · espectadores: ${viewers.size}`);

function sendState() {
  send({ type: 'state', zoom: cfg.zoom, x: cfg.x, y: cfg.y, mirror: cfg.mirror, paused });
}

function applyView() {
  $('prev').style.transform =
    `translate(${cfg.x}%, ${cfg.y}%) scale(${cfg.zoom})${cfg.mirror ? ' scaleX(-1)' : ''}`;
  $('zoomV').textContent = cfg.zoom.toFixed(2) + 'x';
  $('pxV').textContent = cfg.x; $('pyV').textContent = cfg.y;
  save(); sendState();
}

function applyTracks() {
  if (!stream) return;
  stream.getVideoTracks().forEach(t => t.enabled = !paused);
  stream.getAudioTracks().forEach(t => t.enabled = cfg.mic);
}

function closePeer(id) {
  if (pcs[id]) { pcs[id].close(); delete pcs[id]; }
}

async function createPeer(id) {
  if (!stream || !viewers.has(id)) return;
  closePeer(id);
  const pc = new RTCPeerConnection({ iceServers });
  pcs[id] = pc;
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  pc.onicecandidate = e => e.candidate && send({ to: id, type: 'ice', candidate: e.candidate });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' && pcs[id] === pc) setTimeout(() => createPeer(id), 1500);
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  for (const s of pc.getSenders()) {
    if (s.track && s.track.kind === 'video') {
      const p = s.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = QUALITY[cfg.quality].br;
      try { await s.setParameters(p); } catch (e) {}
    }
  }
  send({ to: id, type: 'offer', sdp: pc.localDescription });
}

async function onMsg(m) {
  if (m.type === 'viewer-joined') {
    viewers.add(m.id); sendState(); await createPeer(m.id);
  } else if (m.type === 'viewer-left') {
    viewers.delete(m.id); closePeer(m.id);
  } else if (m.type === 'answer' && pcs[m.from]) {
    await pcs[m.from].setRemoteDescription(m.sdp);
  } else if (m.type === 'ice' && pcs[m.from]) {
    try { await pcs[m.from].addIceCandidate(m.candidate); } catch (e) {}
  }
  refreshStatus();
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=push&key=${encodeURIComponent(KEY)}`);
  ws.onopen = () => { refreshStatus(); sendState(); };
  ws.onmessage = e => { queue = queue.then(() => onMsg(JSON.parse(e.data))).catch(console.error); };
  ws.onclose = () => {
    Object.keys(pcs).forEach(closePeer); viewers.clear();
    setStatus('Reconectando... (confira a senha no link)'); setTimeout(connect, 2000);
  };
}

async function listCams() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  $('cam').innerHTML = devs.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Câmera ' + (i + 1)}</option>`).join('');
  if (devs.some(d => d.deviceId === cfg.cam)) $('cam').value = cfg.cam;
}

async function startCamera() {
  const q = QUALITY[$('quality').value];
  cfg.quality = $('quality').value; cfg.cam = $('cam').value; save();
  if (stream) stream.getTracks().forEach(t => t.stop());
  const video = { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps } };
  if (cfg.cam) video.deviceId = { exact: cfg.cam };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    try { stream = await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
    catch (e2) { stream = null; setStatus('Erro: ' + e2.name + ' (permita a câmera / use localhost ou HTTPS)'); return; }
  }
  $('prev').srcObject = stream;
  keepAwake();
  applyTracks();
  await listCams();
  if (cfg.cam) $('cam').value = cfg.cam;
  for (const id of viewers) await createPeer(id);
  refreshStatus();
}

async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && stream) keepAwake();
});

function setMicBtn() {
  $('mic').textContent = 'Microfone: ' + (cfg.mic ? 'ligado' : 'desligado');
  $('mic').className = cfg.mic ? 'on' : 'off';
}
function setPauseBtn() {
  $('pause').textContent = paused ? 'Retomar câmera' : 'Pausar câmera';
  $('pause').className = paused ? 'warn' : '';
}

$('start').onclick = startCamera;
$('mic').onclick = () => { cfg.mic = !cfg.mic; setMicBtn(); applyTracks(); save(); };
$('pause').onclick = () => { paused = !paused; setPauseBtn(); applyTracks(); sendState(); };
$('mirror').onchange = e => { cfg.mirror = e.target.checked; applyView(); };
$('zoom').oninput = e => { cfg.zoom = +e.target.value; applyView(); };
$('px').oninput = e => { cfg.x = +e.target.value; applyView(); };
$('py').oninput = e => { cfg.y = +e.target.value; applyView(); };
$('reset').onclick = () => {
  cfg.zoom = 1; cfg.x = 0; cfg.y = 0;
  $('zoom').value = 1; $('px').value = 0; $('py').value = 0; applyView();
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('link').value); } catch (e) { $('link').select(); document.execCommand('copy'); }
  $('copy').textContent = 'Copiado'; setTimeout(() => $('copy').textContent = 'Copiar', 1500);
};

// sinal a cada 30s: evita o Render (plano gratis) dormir durante a live
setInterval(() => send({ type: 'ping' }), 30000);

(async function init() {
  $('quality').value = cfg.quality; $('mirror').checked = cfg.mirror;
  $('zoom').value = cfg.zoom; $('px').value = cfg.x; $('py').value = cfg.y;
  $('link').value = location.origin + '/view' + (KEY ? '?key=' + encodeURIComponent(KEY) : '');
  setMicBtn(); setPauseBtn(); applyView();
  try { iceServers = (await (await fetch('/config')).json()).iceServers; } catch (e) {}
  try { await listCams(); } catch (e) {}
  connect();
})();
