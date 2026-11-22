const P = new URLSearchParams(location.search);
const KEY = P.get('key') || '';
const v = document.getElementById('v');
const pausedEl = document.getElementById('paused');
if (P.get('text')) pausedEl.textContent = P.get('text');
v.muted = P.get('mute') === '1';

let ws = null, pc = null, iceServers = [], queue = Promise.resolve();
const send = o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

function applyState(s) {
  v.style.transform = `translate(${s.x || 0}%, ${s.y || 0}%) scale(${s.zoom || 1})${s.mirror ? ' scaleX(-1)' : ''}`;
  pausedEl.classList.toggle('on', !!s.paused);
}

function closePc() { if (pc) { pc.close(); pc = null; } }

async function onMsg(m) {
  if (m.type === 'offer') {
    closePc();
    const mine = pc = new RTCPeerConnection({ iceServers });
    mine.onicecandidate = e => e.candidate && send({ type: 'ice', candidate: e.candidate });
    mine.ontrack = e => {
      v.srcObject = e.streams[0];
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    };
    await mine.setRemoteDescription(m.sdp);
    const answer = await mine.createAnswer();
    await mine.setLocalDescription(answer);
    send({ type: 'answer', sdp: mine.localDescription });
  } else if (m.type === 'ice' && pc) {
    try { await pc.addIceCandidate(m.candidate); } catch (e) {}
  } else if (m.type === 'state') {
    applyState(m);
  } else if (m.type === 'push-left') {
    closePc(); v.srcObject = null;
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=view&key=${encodeURIComponent(KEY)}`);
  ws.onmessage = e => { queue = queue.then(() => onMsg(JSON.parse(e.data))).catch(console.error); };
  ws.onclose = () => setTimeout(connect, 2000);
}

(async function init() {
  try { iceServers = (await (await fetch('/config')).json()).iceServers; } catch (e) {}
  connect();
})();
