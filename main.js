// ============================================================
//  main.js — Smart Room Monitor
//  INC272: Web-Based IoT Applications (2026)
//
//  Simulator response format (from server.js):
//    "ok: adc,0,756,12,inc"   → type=adc, id=0, value=756
//    "ok: psw,1,1,KEY_DOWN"   → type=psw, id=1, state=1
//    "ok: led,0,1"            → type=led, id=0, state=1
//    "ok: led,0,1,0"          → broadcast format (4 parts)
//    "ok: pwm,0,1,0.75"       → type=pwm confirmation
//  All responses start with "ok: " — strip before parsing.
// ============================================================

const WS_URL = 'ws://127.0.0.1:3000/ecclab';

let ws          = null;
let pollingTimer = null;
let isActive = false; // Add this line
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const lastMsg    = document.getElementById('last-msg');
const logPanel   = document.getElementById('log');

// ── Connect ─────────────────────────────────────────────────
function connect() {
  setStatus('connecting', 'Connecting…');
  log('Connecting to ' + WS_URL, 'info');

  ws = new WebSocket(WS_URL);

  ws.onopen = function () {
    setStatus('connected', 'Connected to simulator');
    log('Connected', 'info');
    //startPolling();
  };

  ws.onmessage = function (event) {
    if (!isActive) return;
    const raw = event.data.trim();
    const isControl = raw.includes('led') || raw.includes('pwm');
    if (!isActive && !isControl) return;
    lastMsg.textContent = raw;
    log('← ' + raw, 'recv');
    handleResponse(raw);
  };

  ws.onclose = function () {
    setStatus('', 'Disconnected');
    log('Connection closed — retrying in 3s…', 'err');
    stopPolling();
    setTimeout(connect, 3000);
  };

  ws.onerror = function () {
    log('WebSocket error', 'err');
  };
}

// ── Send ─────────────────────────────────────────────────────
function send(cmd) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(cmd);
    log('→ ' + cmd, 'sent');
  }
}

// ── Parse simulator responses ────────────────────────────────
//
// Every message from the simulator looks like:
//   "ok: adc,0,756,12,inc"
//
// We need to:
//   1. Remove the "ok: " prefix  →  "adc,0,756,12,inc"
//   2. Split by comma            →  ["adc","0","756","12","inc"]
//   3. Read type (parts[0]), id (parts[1]), value (parts[2])
//
// Special case for LED broadcast:
//   "ok: led,0,1,0"  →  parts[3] is the actual on/off state
//
function handleResponse(raw) {
  if (!isActive) return;
  if (raw.startsWith('err:')) return;

  // Strip "ok: " prefix
  const colonIndex = raw.indexOf(': ');
  if (colonIndex === -1) return;
  const payload = raw.slice(colonIndex + 2);  // e.g. "adc,0,756,12,inc"

  const parts = payload.split(',');
  const type  = parts[0].trim().toLowerCase();
  const id    = parseInt(parts[1]);
  const value = parseInt(parts[2]);

  if (type === 'adc') {
    // "ok: adc,<id>,<value>,<delta>,<direction>"
    // value range: 0–1023
    updateADC(id, value);

  } else if (type === 'psw') {
    // "ok: psw,<id>,<0or1>,KEY_DOWN|KEY_UP"
    updatePSW(id, value);

  } else if (type === 'led') {
    // Direct reply:  "ok: led,<id>,<state>"      (3 parts)
    // Broadcast:     "ok: led,<id>,1,<state>"    (4 parts)
    const ledState = parts.length >= 4 ? parseInt(parts[3]) : value;
    updateLED(id, ledState);
  }
}

// ── Polling ──────────────────────────────────────────────────
// Simulator also auto-broadcasts every 500ms, but we poll too
// so the UI fills immediately when the page loads.
const POLL_INTERVAL_MS = 1000;

function startPolling() {
  if (pollingTimer) return;
  isActive = true;
  log('Polling started (1s)', 'info');
  pollingTimer = setInterval(pollAll, POLL_INTERVAL_MS);
  pollAll(); // immediate first read
}

function stopPolling() {
  if (!pollingTimer) return;
  isActive =false;
  clearInterval(pollingTimer);
  pollingTimer = null;
  log('Polling stopped', 'info');
}

function pollAll() {
  for (let i = 0; i < 4; i++) send('adc,' + i);
  for (let i = 0; i < 4; i++) send('psw,' + i);
}

// ── Button handlers ──────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', function () {
  if (ws && ws.readyState === WebSocket.OPEN) startPolling();
  else log('Not connected', 'err');
});

document.getElementById('btn-stop').addEventListener('click', stopPolling);

// ── LED toggle ───────────────────────────────────────────────
// mode 2 = toggle. Server replies: "ok: led,<id>,<newState>"
function toggleLED(id) {
  send('led,' + id + ',2');
}

// ── PWM control ──────────────────────────────────────────────
// Simulator PWM modes:
//   mode 0 = set frequency
//   mode 1 = set duty cycle  (value 0.0–1.0)
//   mode 2 = set phase
//   mode 3 = enable/disable  (value 1 or 0)
//
// Slider gives 0–100%, we convert to 0.00–1.00
// We also enable the channel (mode 3,1) when slider moves.
function setPWM(id, percent) {
  document.getElementById('pwm' + id + '-val').textContent = percent;
  const duty = (percent / 100).toFixed(2);
  send('pwm,' + id + ',3,1');       // enable channel first
  send('pwm,' + id + ',1,' + duty); // then set duty ratio
}

// ── UI update functions ───────────────────────────────────────

// ADC bar: simulator range is 0–1023
function updateADC(id, value) {
  const pct = Math.round((value / 1023) * 100);
  const bar = document.getElementById('adc' + id + '-bar');
  const val = document.getElementById('adc' + id + '-val');
  if (bar) bar.style.width = pct + '%';
  if (val) val.textContent = value;
}

// PSW dot: green when pressed (1), dark when released (0)
function updatePSW(id, value) {
  const dot = document.getElementById('psw' + id);
  if (!dot) return;
  dot.classList.toggle('on', value === 1);
}

// LED icon: yellow glow when on (1), dark when off (0)
function updateLED(id, value) {
  const icon  = document.getElementById('led' + id + '-icon');
  const label = document.getElementById('led' + id + '-state');
  if (!icon || !label) return;
  icon.classList.toggle('on', value === 1);
  label.textContent = value === 1 ? 'ON' : 'OFF';
}

// ── Status bar ────────────────────────────────────────────────
function setStatus(cls, text) {
  statusDot.className = cls;
  statusText.textContent = text;
}

// ── Log panel ─────────────────────────────────────────────────
function log(msg, type) {
  const p  = document.createElement('p');
  const ts = new Date().toTimeString().slice(0, 8);
  p.textContent = '[' + ts + '] ' + msg;
  p.className   = type || '';
  logPanel.appendChild(p);
  logPanel.scrollTop = logPanel.scrollHeight;
}

// ── Kick everything off ───────────────────────────────────────
connect();
