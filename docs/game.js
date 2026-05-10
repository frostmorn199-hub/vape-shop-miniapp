"use strict";

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// ─── Полифилл roundRect ──────────────────────────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
    return this;
  };
}

// ─── Призы ──────────────────────────────────────────────
const PRIZES = [
  { id: 'disc10', label: 'Скидка\n10%',         emoji: '🏷️', color: '#c0392b', isPromo: true,  prefix: 'VAPE10' },
  { id: 'liquid', label: 'Любая\nжидкость',     emoji: '💧', color: '#1a5276', isPromo: false },
  { id: 'disc5',  label: 'Скидка\n5%',          emoji: '💸', color: '#d35400', isPromo: true,  prefix: 'VAPE5'  },
  { id: 'disp',   label: 'Одноразка\n2500 тяг', emoji: '🔥', color: '#6c3483', isPromo: false },
  { id: 'points', label: '+500\nбаллов',        emoji: '💰', color: '#1e6b35', isPromo: false },
  { id: 'coal',   label: 'Уголь для\nкальяна',  emoji: '🪨', color: '#424949', isPromo: false },
];
const PRIZE_TEXTS = {
  disc10: 'Скидка 10% на следующий заказ!',
  disc5:  'Скидка 5% на следующий заказ!',
  points: '+500 бонусных баллов на счёт!',
  disp:   'Любая одноразка до 2500 затяжек — бесплатно!',
  liquid: 'Любая жидкость — бесплатно!',
  coal:   'Уголь для кальяна — бесплатно!',
};

// ─── API ────────────────────────────────────────────────
const BASE_URL = "https://vape-shop-miniapp.onrender.com";
const TG_UID   = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || "";

async function registerPromoCode(code, type, discount) {
  try {
    await fetch(`${BASE_URL}/api/register-promo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, type, discount, uid: TG_UID }),
    });
  } catch (e) { console.warn("registerPromoCode failed", e); }
}

async function addCoinsToBalance(smokeCount) {
  if (!TG_UID || smokeCount <= 0) return;
  try {
    await fetch(`${BASE_URL}/api/add-coins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: TG_UID, smoke: smokeCount }),
    });
  } catch (e) { console.warn("addCoinsToBalance failed", e); }
}

// ─── Сторадж ────────────────────────────────────────────
const genCode        = p  => p + '-' + Math.random().toString(36).slice(2,8).toUpperCase();
const todayKey       = () => new Date().toISOString().slice(0,10);
const hasSpun        = () => localStorage.getItem('vr_spin_date') === todayKey();
const markSpun       = (id, code) => {
  localStorage.setItem('vr_spin_date', todayKey());
  localStorage.setItem('vr_last_prize', JSON.stringify({ id, code }));
};
const getBest        = () => parseInt(localStorage.getItem('vr_best') || '0');
const saveBest       = s  => { if (s > getBest()) localStorage.setItem('vr_best', s); };
const getTotalCoins  = () => parseInt(localStorage.getItem('vr_coins') || '0');
const saveTotalCoins = n  => localStorage.setItem('vr_coins', getTotalCoins() + n);

// ════════════════════════════════════════════════════════
//  ЗВУК (Web Audio API)
// ════════════════════════════════════════════════════════
let _aCtx = null, _musicGain = null, _musicActive = false;
let _nextBeat = 0, _beatNum = 0;
const TEMPO = 60 / 128; // ~0.469 сек/удар (128 BPM)

function _getACtx() {
  if (!_aCtx) {
    _aCtx = new (window.AudioContext || window.webkitAudioContext)();
    _musicGain = _aCtx.createGain();
    _musicGain.gain.value = 0.20;
    _musicGain.connect(_aCtx.destination);
  }
  if (_aCtx.state === 'suspended') _aCtx.resume();
  return _aCtx;
}

function playCollectSound() {
  try {
    const ac = _getACtx();
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1050, ac.currentTime + 0.05);
    osc.frequency.exponentialRampToValueAtTime(520,  ac.currentTime + 0.12);
    g.gain.setValueAtTime(0.10, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.14);
    osc.connect(g); g.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + 0.14);
  } catch(e) {}
}

function playCrashSound() {
  try {
    const ac = _getACtx();
    // Глухой удар
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(28, ac.currentTime + 0.30);
    g.gain.setValueAtTime(0.75, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.35);
    // Шумовой треск
    const sz  = Math.floor(ac.sampleRate * 0.22);
    const buf = ac.createBuffer(1, sz, ac.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < sz; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/sz, 0.5);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g2 = ac.createGain();
    f.type = 'lowpass'; f.frequency.value = 700;
    g2.gain.setValueAtTime(0.5, ac.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22);
    src.buffer = buf; src.connect(f); f.connect(g2); g2.connect(ac.destination);
    src.start(); src.stop(ac.currentTime + 0.22);
  } catch(e) {}
}

function _kick(t) {
  const ac = _aCtx, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.18);
  g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g); g.connect(_musicGain); o.start(t); o.stop(t + 0.22);
}

function _snare(t) {
  const ac = _aCtx, dur = 0.14;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/d.length, 1.3);
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 0.6;
  g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.buffer = buf; src.connect(f); f.connect(g); g.connect(_musicGain);
  src.start(t); src.stop(t + dur);
}

function _hihat(t, open) {
  const ac = _aCtx, dur = open ? 0.18 : 0.05;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random()*2-1;
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = 'highpass'; f.frequency.value = 8500;
  g.gain.setValueAtTime(open ? 0.13 : 0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.buffer = buf; src.connect(f); f.connect(g); g.connect(_musicGain);
  src.start(t); src.stop(t + dur);
}

function _bassNote(t, freq) {
  const ac = _aCtx, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o.type = 'sawtooth'; o.frequency.value = freq;
  f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 2.5;
  g.gain.setValueAtTime(0.38, t); g.gain.exponentialRampToValueAtTime(0.001, t + TEMPO * 0.70);
  o.connect(f); f.connect(g); g.connect(_musicGain);
  o.start(t); o.stop(t + TEMPO * 0.70);
}

const _BASSLINE = [55, 55, 55, 55, 82.4, 55, 73.4, 82.4];

function _scheduleBeats() {
  if (!_musicActive || !_aCtx) return;
  while (_nextBeat < _aCtx.currentTime + 0.5) {
    const b = _beatNum % 8;
    if (b === 0 || b === 4) _kick(_nextBeat);
    if (b === 2 || b === 6) _snare(_nextBeat);
    _hihat(_nextBeat, b === 3 || b === 7);
    _bassNote(_nextBeat, _BASSLINE[b]);
    _nextBeat += TEMPO;
    _beatNum++;
  }
  setTimeout(_scheduleBeats, 100);
}

function startMusic() {
  _getACtx();
  if (_musicActive) return;
  _musicActive = true;
  _nextBeat    = _aCtx.currentTime + 0.1;
  _beatNum     = 0;
  _scheduleBeats();
}

function stopMusic() {
  _musicActive = false;
}

// ─── Навигация ───────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ════════════════════════════════════════════════════════
//  СТАРТ
// ════════════════════════════════════════════════════════
function initStart() {
  const best = getBest();
  document.getElementById('best-display').textContent = best > 0 ? `🏆 Рекорд: ${best}` : '';

  const wheelBtn   = document.getElementById('btn-wheel');
  const cooldownEl = document.getElementById('wheel-cooldown');

  if (hasSpun()) {
    wheelBtn.disabled    = true;
    wheelBtn.textContent = '✅ Уже крутили сегодня';
    const now = new Date(), midnight = new Date();
    midnight.setHours(24,0,0,0);
    const diff = midnight - now;
    document.getElementById('next-spin').textContent =
      `${Math.floor(diff/3600000)}ч ${Math.floor((diff%3600000)/60000)}мин`;
    cooldownEl.classList.remove('hidden');
  } else {
    wheelBtn.disabled    = false;
    wheelBtn.textContent = '🎰 Крутить колесо';
    cooldownEl.classList.add('hidden');
  }

  document.getElementById('btn-play').onclick  = startGame;
  document.getElementById('btn-wheel').onclick = () => { initWheel(); showScreen('s-wheel'); };
}

// ════════════════════════════════════════════════════════
//  КОЛЕСО ФОРТУНЫ
// ════════════════════════════════════════════════════════
let wheelAngle = 0, spinning = false;

function initWheel() {
  const pad  = 34;
  const size = Math.min(window.innerWidth * 0.80, 300);
  const wc   = document.getElementById('wheelCanvas');
  wc.width = wc.height = size + pad * 2;
  drawWheel(wheelAngle);
  const btn = document.getElementById('btn-spin');
  if (hasSpun()) { btn.disabled = true; btn.textContent = 'Уже крутили'; }
  else           { btn.disabled = false; btn.textContent = 'Крутить!'; btn.onclick = spinWheel; }
}

function drawWheel(angle) {
  const wc   = document.getElementById('wheelCanvas');
  const wctx = wc.getContext('2d');
  const cx   = wc.width / 2, cy = wc.height / 2;
  const pad  = 34;
  const r    = cx - pad - 2;
  const arc  = (Math.PI * 2) / PRIZES.length;
  wctx.clearRect(0, 0, wc.width, wc.height);

  PRIZES.forEach((p, i) => {
    const s = angle + arc * i - Math.PI / 2, e = s + arc;
    wctx.beginPath(); wctx.moveTo(cx, cy); wctx.arc(cx, cy, r, s, e); wctx.closePath();
    wctx.fillStyle   = p.color; wctx.fill();
    wctx.strokeStyle = 'rgba(0,0,0,0.25)'; wctx.lineWidth = 1.5; wctx.stroke();

    wctx.save();
    wctx.translate(cx, cy);
    wctx.rotate(s + arc / 2);
    wctx.textAlign   = 'right';
    wctx.fillStyle   = 'rgba(255,255,255,0.96)';
    wctx.font        = `bold ${Math.round(wc.width * 0.034)}px sans-serif`;
    wctx.shadowColor = 'rgba(0,0,0,0.8)'; wctx.shadowBlur = 5;
    p.label.split('\n').forEach((line, li, arr) => {
      wctx.fillText(line, r - 12, (li - (arr.length - 1) / 2) * wc.width * 0.040);
    });
    wctx.font = `${Math.round(wc.width * 0.052)}px serif`;
    wctx.shadowBlur = 0;
    wctx.textAlign = 'left';
    wctx.fillText(p.emoji, 14, wc.width * 0.018);
    wctx.restore();
  });

  wctx.beginPath(); wctx.arc(cx, cy, r, 0, Math.PI * 2);
  wctx.strokeStyle = 'rgba(255,255,255,0.15)'; wctx.lineWidth = 2; wctx.stroke();

  const normalizedAngle = ((-angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const currentSeg      = Math.floor(normalizedAngle / arc) % PRIZES.length;
  const segStart        = angle + arc * currentSeg - Math.PI / 2;
  const segEnd          = segStart + arc;
  const fR = r + 10, fR2 = r + 22;

  wctx.beginPath(); wctx.arc(cx, cy, fR, 0, Math.PI * 2);
  wctx.strokeStyle = 'rgba(255,190,0,0.55)'; wctx.lineWidth = 5; wctx.stroke();
  wctx.beginPath(); wctx.arc(cx, cy, fR2, 0, Math.PI * 2);
  wctx.strokeStyle = 'rgba(200,140,0,0.30)'; wctx.lineWidth = 3; wctx.stroke();

  for (let i = 0; i < PRIZES.length; i++) {
    const tickA = angle + arc * i - Math.PI / 2;
    const x1 = cx + Math.cos(tickA) * (r - 1), y1 = cy + Math.sin(tickA) * (r - 1);
    const x2 = cx + Math.cos(tickA) * (fR2 + 6), y2 = cy + Math.sin(tickA) * (fR2 + 6);
    wctx.strokeStyle = 'rgba(255,220,80,0.7)'; wctx.lineWidth = 2;
    wctx.beginPath(); wctx.moveTo(x1, y1); wctx.lineTo(x2, y2); wctx.stroke();
    wctx.fillStyle = '#ffcf40';
    wctx.beginPath(); wctx.arc(x2, y2, 3.5, 0, Math.PI * 2); wctx.fill();
  }

  wctx.save();
  wctx.shadowColor = 'rgba(255,240,80,1)'; wctx.shadowBlur = 18;
  wctx.beginPath(); wctx.arc(cx, cy, fR, segStart, segEnd);
  wctx.strokeStyle = 'rgba(255,240,100,0.95)'; wctx.lineWidth = 7; wctx.stroke();
  wctx.restore();

  wctx.beginPath(); wctx.arc(cx, cy, 24, 0, Math.PI * 2);
  const hubGrad = wctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, 24);
  hubGrad.addColorStop(0, '#ffcf40'); hubGrad.addColorStop(0.5, '#e65c00'); hubGrad.addColorStop(1, '#7a2d00');
  wctx.fillStyle = hubGrad; wctx.fill();
  wctx.strokeStyle = 'rgba(255,200,50,0.7)'; wctx.lineWidth = 2; wctx.stroke();
  wctx.font = '16px serif'; wctx.textAlign = 'center'; wctx.textBaseline = 'middle';
  wctx.shadowBlur = 0; wctx.fillStyle = '#fff'; wctx.fillText('💨', cx, cy);
}

function spinWheel() {
  if (spinning || hasSpun()) return;
  spinning = true;
  document.getElementById('btn-spin').disabled = true;

  const winIdx    = Math.floor(Math.random() * PRIZES.length);
  const arc       = (Math.PI * 2) / PRIZES.length;
  const target    = -(arc * winIdx + arc / 2);
  const diff      = ((target - wheelAngle) % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
  const totalSpin = diff + Math.PI * 2 * (6 + Math.floor(Math.random()*3));
  const duration  = 5000, t0 = performance.now(), a0 = wheelAngle;

  function step(now) {
    const t = Math.min((now - t0) / duration, 1);
    wheelAngle = a0 + totalSpin * (1 - Math.pow(1-t, 4));
    drawWheel(wheelAngle);
    if (t < 1) { requestAnimationFrame(step); }
    else {
      spinning = false;
      const prize = PRIZES[winIdx];
      const code  = prize.isPromo ? genCode(prize.prefix) : null;
      markSpun(prize.id, code);
      if (code && prize.isPromo) {
        const discountPct = prize.id === 'disc10' ? 10 : 5;
        registerPromoCode(code, prize.id, discountPct);
      }
      showPrize(prize, code);
    }
  }
  requestAnimationFrame(step);
}

function showPrize(prize, code) {
  document.getElementById('prize-emoji').textContent = prize.emoji;
  document.getElementById('prize-text').textContent  = PRIZE_TEXTS[prize.id] || prize.label.replace('\n',' ');
  const codeBox = document.getElementById('prize-code-box');
  const physBox = document.getElementById('prize-physical');
  if (code) {
    document.getElementById('prize-code-val').textContent = code;
    codeBox.classList.remove('hidden'); physBox.classList.add('hidden');
  } else {
    codeBox.classList.add('hidden'); physBox.classList.remove('hidden');
  }
  document.getElementById('btn-play-after').onclick = startGame;
  showScreen('s-prize');
  tg.HapticFeedback?.notificationOccurred('success');
}

window.copyCode = function() {
  const code = document.getElementById('prize-code-val').textContent;
  const btn  = document.getElementById('btn-copy');
  navigator.clipboard?.writeText(code).then(() => {
    btn.textContent = '✅ Скопировано!';
    setTimeout(() => { btn.textContent = '📋 Скопировать'; }, 2000);
  }).catch(() => tg.showAlert('Код: ' + code));
};

// ════════════════════════════════════════════════════════
//  ИГРОВОЙ ДВИЖОК — ПЕРСПЕКТИВА 3D
// ════════════════════════════════════════════════════════
const LANES = 3;

let W, H;
let VPX, VPY;
let GROUND_Y;
let LANE_BOT = [];
let ROAD_BOT_Y;

function setupDims() {
  W          = canvas.width  = window.innerWidth;
  H          = canvas.height = window.innerHeight;
  VPX        = W / 2;
  VPY        = H * 0.26;
  GROUND_Y   = H * 0.80;
  ROAD_BOT_Y = H * 1.08;
  // Расширенные полосы
  LANE_BOT   = [W * 0.08, W * 0.50, W * 0.92];
}

function laneXatY(lane, y) {
  const t = (y - VPY) / (ROAD_BOT_Y - VPY);
  return VPX + (LANE_BOT[lane] - VPX) * Math.max(0, t);
}

function scaleAtY(y) {
  return Math.max(0.01, (y - VPY) / (GROUND_Y - VPY));
}

// ─── Состояние игры ─────────────────────────────────────
let canvas, ctx;
let score, speed, playerLane, targetLane, playerX;
let obstacles, rings, particles, roadOffset, frameCount;
let coins;
let lamps;           // фонарные столбы
let animFrame, gameActive;
let _asphaltPat = null; // кэш текстуры асфальта

function startGame() {
  showScreen('s-game');
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  setupDims();

  score      = 0; speed = 3.0;
  playerLane = 1; targetLane = 1;
  playerX    = LANE_BOT[1];
  obstacles  = []; rings = []; particles = []; lamps = [];
  coins      = 0;
  roadOffset = 0; frameCount = 0;
  gameActive = true;
  _asphaltPat = null; // пересоздаём текстуру под новые размеры
  document.getElementById('hud-score').textContent  = '0';
  document.getElementById('hud-coins').textContent  = '🌀 0';

  startMusic();

  let tx0 = 0, ty0 = 0;
  canvas.ontouchstart = e => { tx0 = e.touches[0].clientX; ty0 = e.touches[0].clientY; e.preventDefault(); };
  canvas.ontouchend   = e => {
    const dx = e.changedTouches[0].clientX - tx0;
    const dy = e.changedTouches[0].clientY - ty0;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 22) moveLane(dx < 0 ? -1 : 1);
    e.preventDefault();
  };
  document.onkeydown = e => {
    if (e.key === 'ArrowLeft')  moveLane(-1);
    if (e.key === 'ArrowRight') moveLane(1);
  };

  cancelAnimationFrame(animFrame);
  loop();
}

function moveLane(d) {
  const n = targetLane + d;
  if (n >= 0 && n < LANES) { targetLane = n; tg.HapticFeedback?.selectionChanged(); }
}

// ─── Основной цикл ──────────────────────────────────────
function loop() {
  if (!gameActive) return;

  frameCount++;
  roadOffset = (roadOffset + speed * 0.9) % 80;
  score++;
  document.getElementById('hud-score').textContent = score;

  if (frameCount % 400 === 0) speed = Math.min(speed + 0.35, 14);

  playerX += (LANE_BOT[targetLane] - playerX) * 0.17;

  // Спавн препятствий
  const rate = Math.max(50, 160 - Math.floor(speed * 9));
  if (frameCount % rate === 0) {
    const lane = Math.floor(Math.random() * LANES);
    const recent = obstacles.filter(o => o.lane === lane && o.y < VPY + H * 0.3);
    if (recent.length === 0) obstacles.push({ lane, y: VPY + 10 });
  }

  // Спавн колечек
  const ringRate = Math.max(55, 110 - Math.floor(speed * 4));
  if (frameCount % ringRate === 0) {
    const lane = Math.floor(Math.random() * LANES);
    const blocked = obstacles.some(o => o.lane === lane && o.y < VPY + H * 0.5 && o.y > VPY + 5);
    if (!blocked) {
      const count = Math.random() < 0.35 ? 3 : 1;
      for (let k = 0; k < count; k++) rings.push({ lane, y: VPY + 10 + k * 40 });
    }
  }

  // Спавн фонарей — каждые ~130 кадров
  if (frameCount % 130 === 0) lamps.push({ y: VPY + 8 });

  // Движение объектов
  obstacles.forEach(o => { const s = scaleAtY(o.y); o.y += speed * (0.8 + s * 2.2); });
  obstacles = obstacles.filter(o => o.y < H + 120);

  rings.forEach(r => { const s = scaleAtY(r.y); r.y += speed * (0.8 + s * 2.2); });
  rings = rings.filter(r => r.y < H + 60);

  lamps.forEach(l => { const s = scaleAtY(l.y); l.y += speed * (0.8 + s * 2.2); });
  lamps = lamps.filter(l => l.y < H + 200);

  // Сбор колечек
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    if (r.lane !== targetLane) continue;
    if (r.y > GROUND_Y - 70 && r.y < GROUND_Y + 30) {
      const rx = laneXatY(r.lane, r.y);
      if (Math.abs(rx - playerX) < W * 0.14) {
        rings.splice(i, 1);
        coins++;
        document.getElementById('hud-coins').textContent = '🌀 ' + coins;
        tg.HapticFeedback?.impactOccurred('light');
        playCollectSound();
        sparkleRing(rx, r.y - 40 * scaleAtY(r.y));
      }
    }
  }

  // Частицы
  particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life--; });
  particles = particles.filter(p => p.life > 0);

  // Столкновения
  for (const o of obstacles) {
    if (o.lane !== targetLane) continue;
    const oy = o.y;
    if (oy > GROUND_Y - 40 && oy < GROUND_Y + 70) {
      const ox = laneXatY(o.lane, oy);
      if (Math.abs(ox - playerX) < W * 0.12) {
        explode(playerX, GROUND_Y);
        gameActive = false;
        tg.HapticFeedback?.notificationOccurred('error');
        playCrashSound();
        stopMusic();
        setTimeout(endGame, 800);
        break;
      }
    }
  }

  render();
  animFrame = requestAnimationFrame(loop);
}

// ─── РЕНДЕР ─────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, W, H);
  drawSky();
  drawRoad();
  drawLamps();
  [...rings].sort((a,b) => a.y - b.y).forEach(drawRing);
  [...obstacles].sort((a,b) => a.y - b.y).forEach(drawBattery);
  drawParticles();
  if (gameActive) drawPlayer();
}

// ── Небо и горизонт ─────────────────────────────────────
function drawSky() {
  // Лунная ночь — холодные синие тона
  const sky = ctx.createLinearGradient(0, 0, 0, VPY);
  sky.addColorStop(0,   '#02020e');
  sky.addColorStop(0.5, '#06061c');
  sky.addColorStop(1,   '#0b0b28');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, VPY + 4);

  // Звёзды
  if (!drawSky._stars) {
    drawSky._stars = Array.from({length: 110}, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.4 + Math.random() * 1.6,
      a: 0.3 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
    }));
  }
  drawSky._stars.forEach(s => {
    const twinkle = s.a * (0.65 + Math.sin(frameCount * 0.025 + s.phase) * 0.35);
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * VPY * 0.88, s.r, 0, Math.PI*2);
    ctx.fillStyle = `rgba(220,230,255,${twinkle.toFixed(2)})`;
    ctx.fill();
  });

  drawMoon();
  drawCitySilhouette();

  // Лунное свечение на горизонте — холодное голубоватое
  const glow = ctx.createLinearGradient(0, VPY - 25, 0, VPY + 20);
  glow.addColorStop(0,   'rgba(80,120,200,0)');
  glow.addColorStop(0.5, 'rgba(80,120,200,0.18)');
  glow.addColorStop(1,   'rgba(80,120,200,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, VPY - 25, W, 45);
}

// ── Полумесяц ───────────────────────────────────────────
function drawMoon() {
  const mx = W * 0.78, my = VPY * 0.30, mr = Math.min(W, VPY) * 0.09;

  // Ореол луны
  const halo = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.2);
  halo.addColorStop(0,   'rgba(200,220,255,0.12)');
  halo.addColorStop(0.5, 'rgba(160,190,255,0.05)');
  halo.addColorStop(1,   'transparent');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(mx, my, mr * 3.2, 0, Math.PI*2); ctx.fill();

  // Диск луны
  ctx.fillStyle = '#d8e8ff';
  ctx.shadowColor = 'rgba(180,210,255,0.7)';
  ctx.shadowBlur = mr * 1.2;
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // Тёмный круг — создаёт форму полумесяца
  ctx.fillStyle = '#04040f';
  ctx.beginPath(); ctx.arc(mx + mr * 0.52, my - mr * 0.08, mr * 0.84, 0, Math.PI*2); ctx.fill();

  // Кратеры на видимой части
  ctx.fillStyle = 'rgba(170,195,240,0.25)';
  [[mx - mr*0.38, my - mr*0.05, mr*0.10],
   [mx - mr*0.55, my + mr*0.28, mr*0.07],
   [mx - mr*0.20, my + mr*0.38, mr*0.06]].forEach(([cx2, cy2, cr]) => {
    ctx.beginPath(); ctx.arc(cx2, cy2, cr, 0, Math.PI*2); ctx.fill();
  });
}

// ── Силуэт города ───────────────────────────────────────
function drawCitySilhouette() {
  if (!drawCitySilhouette._data) {
    const builds = [];
    let x = 0;
    while (x < W) {
      const w = W * (0.04 + Math.random() * 0.07);
      const h = VPY * (0.25 + Math.random() * 0.70);
      const hasAntenna = Math.random() > 0.6;
      const neonColor  = ['#ff2266','#00ffe0','#9933ff','#ff8800','#00aaff'][Math.floor(Math.random()*5)];
      builds.push({ x, w: w - 1, h, hasAntenna, neonColor, neonOn: Math.random() > 0.5 });
      x += w;
    }
    drawCitySilhouette._data = builds;
  }

  const bld = drawCitySilhouette._data;

  // Тени зданий
  ctx.fillStyle = '#060618';
  bld.forEach(b => ctx.fillRect(b.x, VPY - b.h, b.w, b.h));

  bld.forEach(b => {
    // Окна
    for (let wy = VPY - b.h + 5; wy < VPY - 5; wy += 9) {
      for (let wx = b.x + 3; wx < b.x + b.w - 5; wx += 7) {
        if (Math.random() > 0.42) {
          // Иногда цветное окно (неон)
          const isNeon = Math.random() > 0.88;
          if (isNeon) {
            ctx.fillStyle = b.neonColor;
            ctx.shadowColor = b.neonColor;
            ctx.shadowBlur = 4;
          } else {
            ctx.fillStyle = `rgba(255,235,120,${0.12 + Math.random() * 0.30})`;
            ctx.shadowBlur = 0;
          }
          ctx.fillRect(wx, wy, 4, 5);
          ctx.fillStyle = '#060618';
          ctx.shadowBlur = 0;
        }
      }
    }
    // Антенна
    if (b.hasAntenna) {
      ctx.strokeStyle = '#0d0d24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(b.x + b.w/2, VPY - b.h);
      ctx.lineTo(b.x + b.w/2, VPY - b.h - VPY * 0.12);
      ctx.stroke();
      // Мигающий огонёк
      if ((frameCount + Math.floor(b.x)) % 80 < 40) {
        ctx.fillStyle = 'rgba(255,60,60,0.85)';
        ctx.shadowColor = '#ff3333'; ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(b.x + b.w/2, VPY - b.h - VPY * 0.12, 2, 0, Math.PI*2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    // Неоновая вывеска сбоку некоторых зданий
    if (b.neonOn && b.w > W * 0.055) {
      const signY = VPY - b.h * 0.45;
      ctx.strokeStyle = b.neonColor;
      ctx.shadowColor = b.neonColor;
      ctx.shadowBlur  = 6 + Math.sin(frameCount * 0.04 + b.x) * 3;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.roundRect(b.x + 3, signY, b.w - 6, 6, 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  });
}

// ── Дорога ──────────────────────────────────────────────
function _getAsphaltPattern() {
  if (_asphaltPat) return _asphaltPat;
  const oc = document.createElement('canvas');
  oc.width = oc.height = 128;
  const oc2 = oc.getContext('2d');
  oc2.fillStyle = '#181826';
  oc2.fillRect(0, 0, 128, 128);
  // Зерно
  for (let i = 0; i < 2800; i++) {
    const px = Math.random() * 128, py = Math.random() * 128;
    const v  = 4 + Math.random() * 30;
    oc2.fillStyle = `rgba(${v+8},${v+8},${v+16},${0.25 + Math.random() * 0.45})`;
    oc2.fillRect(px, py, Math.random() * 1.8, Math.random() * 1.8);
  }
  // Трещины
  for (let i = 0; i < 6; i++) {
    oc2.strokeStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.18})`;
    oc2.lineWidth = 0.6;
    oc2.beginPath();
    let cx2 = Math.random() * 128, cy2 = Math.random() * 128;
    oc2.moveTo(cx2, cy2);
    for (let j = 0; j < 3; j++) {
      cx2 += (Math.random() - 0.5) * 22; cy2 += (Math.random() - 0.5) * 22;
      oc2.lineTo(cx2, cy2);
    }
    oc2.stroke();
  }
  _asphaltPat = ctx.createPattern(oc, 'repeat');
  return _asphaltPat;
}

function drawRoad() {
  // Базовый асфальт — градиент
  const road = ctx.createLinearGradient(0, VPY, 0, H);
  road.addColorStop(0,   '#10101f');
  road.addColorStop(0.4, '#16162a');
  road.addColorStop(1,   '#0c0c1c');
  ctx.fillStyle = road;
  ctx.beginPath();
  ctx.moveTo(VPX, VPY);
  ctx.lineTo(-W * 0.10, H);
  ctx.lineTo(W * 1.10, H);
  ctx.closePath();
  ctx.fill();

  // Текстура асфальта поверх (низкая прозрачность)
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle   = _getAsphaltPattern();
  ctx.beginPath();
  ctx.moveTo(VPX, VPY);
  ctx.lineTo(-W * 0.10, H);
  ctx.lineTo(W * 1.10, H);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // Лунный блик на дороге
  const moonRef = ctx.createLinearGradient(0, VPY, 0, H);
  moonRef.addColorStop(0,   'rgba(100,130,200,0.0)');
  moonRef.addColorStop(0.3, 'rgba(100,130,200,0.06)');
  moonRef.addColorStop(1,   'rgba(100,130,200,0.0)');
  ctx.fillStyle = moonRef;
  ctx.beginPath();
  ctx.moveTo(VPX, VPY);
  ctx.lineTo(-W * 0.10, H);
  ctx.lineTo(W * 1.10, H);
  ctx.closePath();
  ctx.fill();

  // Боковые полосы разметки
  [0, W].forEach(ex => {
    const grad = ctx.createLinearGradient(0, VPY, 0, H);
    grad.addColorStop(0,   'rgba(180,200,255,0)');
    grad.addColorStop(0.5, 'rgba(180,200,255,0.30)');
    grad.addColorStop(1,   'rgba(180,200,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.moveTo(VPX, VPY);
    ctx.lineTo(ex, H);
    ctx.stroke();
  });

  // Пунктирные разделители
  const dividers = [
    { bot: (LANE_BOT[0] + LANE_BOT[1]) / 2 },
    { bot: (LANE_BOT[1] + LANE_BOT[2]) / 2 },
  ];
  ctx.setLineDash([22, 22]);
  ctx.lineWidth = 2;
  dividers.forEach(d => {
    for (let y = VPY; y < H; y += 44) {
      const dashOffset = (roadOffset * 2) % 44;
      const y1 = y - dashOffset, y2 = Math.min(y1 + 22, H);
      if (y2 <= VPY) continue;
      const x1 = VPX + (d.bot - VPX) * Math.max(0, (y1-VPY)/(ROAD_BOT_Y-VPY));
      const x2 = VPX + (d.bot - VPX) * Math.max(0, (y2-VPY)/(ROAD_BOT_Y-VPY));
      const alpha = Math.max(0, (y1-VPY)/(H-VPY)) * 0.45;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
  });
  ctx.setLineDash([]);

  // Центральная жёлтая линия
  for (let y = VPY; y < H; y += 50) {
    const y1 = y - (roadOffset % 50), y2 = Math.min(y1+24, H);
    if (y2 <= VPY) continue;
    const x1 = VPX + (LANE_BOT[1]-VPX) * Math.max(0,(y1-VPY)/(ROAD_BOT_Y-VPY));
    const x2 = VPX + (LANE_BOT[1]-VPX) * Math.max(0,(y2-VPY)/(ROAD_BOT_Y-VPY));
    const alpha = Math.max(0,(y1-VPY)/(H-VPY)) * 0.28;
    ctx.strokeStyle = `rgba(255,190,0,${alpha})`;
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }

  // Подсветка текущей полосы
  const lx = laneXatY(targetLane, GROUND_Y);
  const laneGlow = ctx.createRadialGradient(lx, GROUND_Y, 0, lx, GROUND_Y, W * 0.24);
  laneGlow.addColorStop(0,   'rgba(80,120,220,0.12)');
  laneGlow.addColorStop(1,   'transparent');
  ctx.fillStyle = laneGlow;
  ctx.fillRect(0, VPY, W, H - VPY);
}

// ── Фонарные столбы ─────────────────────────────────────
function drawLamps() {
  lamps.forEach(l => {
    const sc  = scaleAtY(l.y);
    const t   = Math.max(0, (l.y - VPY) / (ROAD_BOT_Y - VPY));

    // Позиции: левый и правый края дороги + небольшой отступ
    const lx  = VPX + (-W * 0.14 - VPX) * t;
    const rx  = VPX + (W * 1.14  - VPX) * t;

    [lx, rx].forEach((px, side) => {
      const postH = 95 * sc;
      const postW = Math.max(1, 4.5 * sc);
      const armL  = (side === 0 ? 1 : -1) * 18 * sc; // рука внутрь

      // Столб
      ctx.fillStyle = '#1e1e38';
      ctx.fillRect(px - postW/2, l.y - postH, postW, postH);

      // Горизонтальная рука
      ctx.fillRect(px - postW/2, l.y - postH, armL, postW * 1.2);

      // Плафон
      const hx = px + armL;
      const hy = l.y - postH;
      ctx.fillStyle = '#2a2a46';
      ctx.beginPath();
      ctx.roundRect(hx - 7*sc, hy - 4*sc, 14*sc, 6*sc, 2*sc);
      ctx.fill();

      // Конус света (вниз)
      const coneR = 50 * sc;
      const cg = ctx.createRadialGradient(hx, hy + 4*sc, 0, hx, hy + 4*sc, coneR);
      cg.addColorStop(0,   `rgba(190,215,255,${0.18 * sc})`);
      cg.addColorStop(0.5, `rgba(160,195,255,${0.07 * sc})`);
      cg.addColorStop(1,   'transparent');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(hx, hy + 4*sc, coneR, 0, Math.PI*2); ctx.fill();

      // Лампочка
      ctx.fillStyle = '#e0efff';
      ctx.shadowColor = 'rgba(190,220,255,0.95)';
      ctx.shadowBlur  = 8 * sc;
      ctx.beginPath(); ctx.arc(hx, hy, 2.5*sc, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    });
  });
}

// ── Персонаж ─────────────────────────────────────────────
function drawPlayer() {
  const x   = playerX, y = GROUND_Y;
  const pw  = Math.min(W * 0.22, 100);
  const ph  = pw * 2.0;
  const bob = Math.sin(frameCount * 0.16) * 4 + Math.sin(frameCount * 0.3) * 1.5;
  const tilt = (LANE_BOT[targetLane] - playerX) / (W * 0.35) * 0.10;

  const sg = ctx.createRadialGradient(x, y+8, 1, x, y+8, pw*0.55);
  sg.addColorStop(0, 'rgba(0,0,0,0.65)'); sg.addColorStop(1, 'transparent');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.ellipse(x, y+10, pw*0.50, pw*0.12, 0, 0, Math.PI*2);
  ctx.fill();

  drawVapeCharacter(x, y, pw, ph, bob, tilt);
}

function drawVapeCharacter(cx, cy, pw, ph, bob, tilt) {
  const run  = Math.sin(frameCount * 0.32);
  const run2 = Math.sin(frameCount * 0.32 + Math.PI);

  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.rotate(tilt);

  const legH  = ph * 0.30, bodyH = ph * 0.44, headR = pw * 0.26;
  const bodyW = pw * 0.68, bodyX = -bodyW / 2;
  const bodyY = -(legH + bodyH), headY = bodyY - headR * 1.05, bodyBR = bodyW * 0.14;

  const legOffX = bodyW * 0.20, legW = pw * 0.09;
  const shoeRx  = pw * 0.13, shoeRy = pw * 0.065;

  [[-legOffX,'#f06292',run*0.40],[ legOffX,'#26c6da',run2*0.40]].forEach(([lx,col,angle]) => {
    ctx.save(); ctx.translate(lx,-legH); ctx.rotate(angle);
    ctx.strokeStyle=col; ctx.lineWidth=legW; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,legH*0.92); ctx.stroke();
    ctx.fillStyle='#ffffff';
    ctx.beginPath(); ctx.ellipse(shoeRx*0.45,legH*0.92,shoeRx,shoeRy,0.1,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.13)'; ctx.lineWidth=1.2; ctx.stroke();
    ctx.restore();
  });

  const bodyGrad = ctx.createLinearGradient(bodyX,0,bodyX+bodyW,0);
  bodyGrad.addColorStop(0,'#f06292'); bodyGrad.addColorStop(0.48,'#e91e8c');
  bodyGrad.addColorStop(0.52,'#26c6da'); bodyGrad.addColorStop(1,'#00acc1');
  ctx.shadowColor='rgba(240,98,146,0.55)'; ctx.shadowBlur=14;
  ctx.beginPath(); ctx.roundRect(bodyX,bodyY,bodyW,bodyH,bodyBR);
  ctx.fillStyle=bodyGrad; ctx.fill(); ctx.shadowBlur=0;
  ctx.strokeStyle='rgba(255,255,255,0.28)'; ctx.lineWidth=1.8;
  ctx.beginPath(); ctx.roundRect(bodyX,bodyY,bodyW,bodyH,bodyBR); ctx.stroke();
  ctx.strokeStyle='rgba(0,0,0,0.22)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(0,bodyY+5); ctx.lineTo(0,bodyY+bodyH-5); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.13)';
  ctx.beginPath(); ctx.roundRect(bodyX+3,bodyY+4,bodyW-6,bodyH*0.26,bodyBR*0.5); ctx.fill();
  [-bodyW*0.28,bodyW*0.28].forEach((bx2,i) => {
    ctx.fillStyle=i===0?'rgba(255,255,255,0.22)':'rgba(0,200,220,0.35)';
    ctx.beginPath(); ctx.arc(bx2,bodyY+bodyH*0.72,pw*0.055,0,Math.PI*2); ctx.fill();
  });

  const armY=bodyY+bodyH*0.30, armLen=pw*0.30, armW2=pw*0.085, glvR=pw*0.095;
  [[-bodyW/2,'#f06292',run2*0.44,-1],[ bodyW/2,'#26c6da',run*0.44,1]].forEach(([ax,col,angle,dir]) => {
    ctx.save(); ctx.translate(ax,armY); ctx.rotate(angle);
    ctx.strokeStyle=col; ctx.lineWidth=armW2; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(dir*armLen*0.72,armLen*0.58); ctx.stroke();
    ctx.fillStyle='#ffffff';
    ctx.beginPath(); ctx.arc(dir*armLen*0.72,armLen*0.58,glvR,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.12)'; ctx.lineWidth=1; ctx.stroke();
    ctx.restore();
  });

  const headGrad = ctx.createRadialGradient(-headR*0.25,headY-headR*0.25,headR*0.1,0,headY,headR);
  headGrad.addColorStop(0,'#ff9fc8'); headGrad.addColorStop(0.55,'#f06292'); headGrad.addColorStop(1,'#c2185b');
  ctx.shadowColor='rgba(240,98,146,0.4)'; ctx.shadowBlur=10;
  ctx.beginPath(); ctx.arc(0,headY,headR,0,Math.PI*2);
  ctx.fillStyle=headGrad; ctx.fill(); ctx.shadowBlur=0;
  ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1.5; ctx.stroke();

  ctx.strokeStyle='#f48fb1'; ctx.lineWidth=pw*0.055; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(0,headY-headR); ctx.lineTo(0,headY-headR*1.55); ctx.stroke();
  for (let p=0;p<3;p++) {
    const vx=Math.sin(frameCount*0.07+p*2.0)*7, vy=headY-headR*1.6-p*11;
    const vr=3.5+p*3, va=(0.28-p*0.08)*(0.5+Math.sin(frameCount*0.09+p)*0.35);
    ctx.beginPath(); ctx.arc(vx,vy,vr,0,Math.PI*2);
    ctx.fillStyle=`rgba(190,220,255,${va.toFixed(2)})`; ctx.fill();
  }

  const ew=headR*0.32, ey=headY;
  ctx.fillStyle='white';
  ctx.beginPath(); ctx.ellipse(-headR*0.40,ey,ew,ew*0.82,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( headR*0.40,ey,ew,ew*0.82,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#1a1a2e';
  ctx.beginPath(); ctx.arc(-headR*0.37+2,ey+1,ew*0.50,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( headR*0.37+2,ey+1,ew*0.50,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(-headR*0.35+3,ey-1.5,ew*0.17,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( headR*0.35+3,ey-1.5,ew*0.17,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=1.7; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(0,ey+ew*1.25,headR*0.28,0.25,Math.PI-0.25); ctx.stroke();

  ctx.restore();
}

// ── Колечко дыма ────────────────────────────────────────
function drawRing(ring) {
  const sc = scaleAtY(ring.y);
  const rx = laneXatY(ring.lane, ring.y);
  const floatH = 58 * sc;
  const ry = ring.y - floatH;
  const outerA = W * 0.038 * sc, outerB = outerA * 0.48;
  const pulse = 0.88 + Math.sin(frameCount * 0.11 + ring.y * 0.04) * 0.12;

  ctx.save(); ctx.translate(rx, ry); ctx.scale(pulse, pulse);
  ctx.shadowColor='rgba(140,230,255,0.9)'; ctx.shadowBlur=12*sc;
  ctx.beginPath(); ctx.ellipse(0,0,outerA,outerB,0,0,Math.PI*2);
  ctx.strokeStyle='rgba(200,248,255,0.95)'; ctx.lineWidth=outerA*0.22; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0,0,outerA*0.55,outerB*0.55,0,0,Math.PI*2);
  ctx.strokeStyle='rgba(255,255,255,0.38)'; ctx.lineWidth=outerA*0.10; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0,0,outerA,outerB,0,Math.PI*1.15,Math.PI*1.65);
  ctx.strokeStyle='rgba(255,255,255,0.75)'; ctx.lineWidth=outerA*0.14; ctx.stroke();
  ctx.shadowBlur=0; ctx.restore();
}

function sparkleRing(x, y) {
  const colors = ['#a0eeff','#ffffff','#80d8ff','#b3f0ff','#e0f7ff'];
  for (let i = 0; i < 14; i++) {
    const a = (i/14)*Math.PI*2, s = 1.5+Math.random()*3.5;
    particles.push({ x,y, vx:Math.cos(a)*s, vy:Math.sin(a)*s-2,
      life:18+Math.floor(Math.random()*12),
      color:colors[Math.floor(Math.random()*colors.length)], r:1.5+Math.random()*2.5 });
  }
}

// ── Батарейка-препятствие ────────────────────────────────
function drawBattery(o) {
  const sc=scaleAtY(o.y), ox=laneXatY(o.lane,o.y), oy=o.y;
  const bw=W*0.18*sc, bh=bw*0.5, tw=bw*0.1, r=bw*0.06;
  const pulse=0.5+Math.sin(frameCount*0.13+oy*0.01)*0.5;
  ctx.save(); ctx.translate(ox,oy);
  ctx.shadowColor=`rgba(231,76,60,${0.7*pulse*sc})`; ctx.shadowBlur=18*sc;
  const bodyGrad=ctx.createLinearGradient(-bw/2,-bh/2,-bw/2,bh/2);
  bodyGrad.addColorStop(0,'#3d1a1a'); bodyGrad.addColorStop(0.4,'#2a0f0f'); bodyGrad.addColorStop(1,'#1a0808');
  ctx.fillStyle=bodyGrad; ctx.strokeStyle='#e74c3c'; ctx.lineWidth=1.5*sc;
  ctx.beginPath(); ctx.roundRect(-bw/2,-bh/2,bw-tw,bh,r); ctx.fill(); ctx.stroke();
  ctx.fillStyle='rgba(255,100,80,0.18)';
  ctx.beginPath(); ctx.roundRect(-bw/2+2,-bh/2+2,bw-tw-4,bh*0.35,r*0.5); ctx.fill();
  const tGrad=ctx.createLinearGradient(bw/2-tw,0,bw/2,0);
  tGrad.addColorStop(0,'#c0392b'); tGrad.addColorStop(1,'#e74c3c');
  ctx.fillStyle=tGrad;
  ctx.beginPath(); ctx.roundRect(bw/2-tw,-bh*0.2,tw-1,bh*0.4,2); ctx.fill();
  const iw=(bw-tw-10)*0.07;
  ctx.fillStyle='#e74c3c'; ctx.shadowBlur=6*sc; ctx.shadowColor='#e74c3c';
  ctx.beginPath(); ctx.roundRect(-bw/2+5,-bh/2+5,Math.max(iw,4),bh-10,2); ctx.fill();
  ctx.shadowBlur=0; ctx.fillStyle='#e74c3c';
  ctx.font=`bold ${bw*0.36}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('!',0,0);
  ctx.strokeStyle='rgba(231,76,60,0.7)'; ctx.lineWidth=1.5*sc;
  const xs=bw*0.1;
  ctx.beginPath(); ctx.moveTo(-xs,-xs*0.8); ctx.lineTo(xs,xs*0.8);
  ctx.moveTo(xs,-xs*0.8); ctx.lineTo(-xs,xs*0.8); ctx.stroke();
  ctx.shadowBlur=0; ctx.restore();
}

// ── Взрыв ────────────────────────────────────────────────
function explode(x, y) {
  const colors=['#ff6b35','#ffbe00','#e74c3c','#ffffff','#ff9a56'];
  for (let i=0;i<22;i++) {
    const a=Math.random()*Math.PI*2, s=2+Math.random()*6;
    particles.push({ x,y, vx:Math.cos(a)*s, vy:Math.sin(a)*s-2,
      life:30+Math.floor(Math.random()*20),
      color:colors[Math.floor(Math.random()*colors.length)], r:2+Math.random()*5 });
  }
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha=p.life/50;
    ctx.fillStyle=p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1;
}

// ─── Конец игры ─────────────────────────────────────────
function endGame() {
  cancelAnimationFrame(animFrame);
  stopMusic();
  saveBest(score);
  saveTotalCoins(coins);
  addCoinsToBalance(coins);
  document.getElementById('go-score').textContent = score;
  document.getElementById('go-best').textContent  = getBest();
  document.getElementById('go-coins').textContent = '🌀 ' + coins;
  document.getElementById('btn-retry').onclick    = startGame;
  showScreen('s-over');
}

// ─── Старт ──────────────────────────────────────────────
initStart();
showScreen('s-start');
