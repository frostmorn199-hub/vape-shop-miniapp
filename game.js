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
  { id: 'disc10', label: 'Скидка\n10%',         emoji: '🎫', color: '#c0392b', isPromo: true,  prefix: 'VAPE10' },
  { id: 'liquid', label: 'Любая\nжидкость',     emoji: '💧', color: '#2471a3', isPromo: false },
  { id: 'disc5',  label: 'Скидка\n5%',          emoji: '🎫', color: '#d35400', isPromo: true,  prefix: 'VAPE5'  },
  { id: 'disp',   label: 'Одноразка\n2500 тяг', emoji: '🔥', color: '#7d3c98', isPromo: false },
  { id: 'points', label: '+500\nбаллов',        emoji: '⭐', color: '#1e8449', isPromo: false },
  { id: 'coal',   label: 'Уголь для\nкальяна',  emoji: '🪨', color: '#566573', isPromo: false },
];
const PRIZE_TEXTS = {
  disc10: 'Скидка 10% на следующий заказ!',
  disc5:  'Скидка 5% на следующий заказ!',
  points: '+500 бонусных баллов на счёт!',
  disp:   'Любая одноразка до 2500 затяжек — бесплатно!',
  liquid: 'Любая жидкость — бесплатно!',
  coal:   'Уголь для кальяна — бесплатно!',
};

// ─── Сторадж ────────────────────────────────────────────
const genCode   = p  => p + '-' + Math.random().toString(36).slice(2,8).toUpperCase();
const todayKey  = () => new Date().toISOString().slice(0,10);
const hasSpun   = () => localStorage.getItem('vr_spin_date') === todayKey();
const markSpun  = (id, code) => {
  localStorage.setItem('vr_spin_date', todayKey());
  localStorage.setItem('vr_last_prize', JSON.stringify({ id, code }));
};
const getBest   = () => parseInt(localStorage.getItem('vr_best') || '0');
const saveBest  = s  => { if (s > getBest()) localStorage.setItem('vr_best', s); };

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
  const size = Math.min(window.innerWidth * 0.82, 310);
  const wc   = document.getElementById('wheelCanvas');
  wc.width = wc.height = size;
  drawWheel(wheelAngle);
  const btn = document.getElementById('btn-spin');
  if (hasSpun()) { btn.disabled = true; btn.textContent = 'Уже крутили'; }
  else           { btn.disabled = false; btn.textContent = 'Крутить!'; btn.onclick = spinWheel; }
}

function drawWheel(angle) {
  const wc  = document.getElementById('wheelCanvas');
  const ctx = wc.getContext('2d');
  const cx  = wc.width / 2, cy = wc.height / 2, r = cx - 6;
  const arc = (Math.PI * 2) / PRIZES.length;
  ctx.clearRect(0,0,wc.width,wc.height);

  PRIZES.forEach((p, i) => {
    const s = angle + arc * i - Math.PI / 2, e = s + arc;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,s,e); ctx.closePath();
    ctx.fillStyle   = p.color; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s + arc / 2);
    ctx.textAlign   = 'right';
    ctx.fillStyle   = 'rgba(255,255,255,0.95)';
    ctx.font        = `bold ${Math.round(wc.width * 0.036)}px sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4;
    p.label.split('\n').forEach((line, li, arr) => {
      ctx.fillText(line, r - 10, (li - (arr.length-1)/2) * wc.width * 0.042);
    });
    ctx.restore();
  });

  // Кольцо + центр
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.strokeStyle = 'rgba(255,190,0,0.5)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,22,0,Math.PI*2);
  ctx.fillStyle   = '#07071a'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,190,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = '15px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.fillText('💨', cx, cy);
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

// Перспективные константы (вычисляются в setupDims)
let W, H;
let VPX, VPY;       // точка схода
let GROUND_Y;       // Y-позиция игрока (горизонт дороги снизу)
let LANE_BOT = [];  // X центров полос у нижнего края
let ROAD_BOT_Y;     // нижний край дороги (за экраном)

function setupDims() {
  W          = canvas.width  = window.innerWidth;
  H          = canvas.height = window.innerHeight;
  VPX        = W / 2;
  VPY        = H * 0.20;           // точка схода (горизонт)
  GROUND_Y   = H * 0.78;           // Y игрока
  ROAD_BOT_Y = H * 1.05;
  // X центров полос у основания экрана
  LANE_BOT   = [W * 0.20, W * 0.50, W * 0.80];
}

/** Экранный X для полосы lane на высоте y */
function laneXatY(lane, y) {
  const t = (y - VPY) / (ROAD_BOT_Y - VPY);
  return VPX + (LANE_BOT[lane] - VPX) * Math.max(0, t);
}

/** Масштаб объекта на высоте y (0 у горизонта → 1 у игрока) */
function scaleAtY(y) {
  return Math.max(0.01, (y - VPY) / (GROUND_Y - VPY));
}

// ─── Состояние игры ─────────────────────────────────────
let canvas, ctx, charImg;
let score, speed, playerLane, targetLane, playerX;
let obstacles, particles, roadOffset, frameCount;
let animFrame, gameActive;

function startGame() {
  showScreen('s-game');
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  setupDims();

  if (!charImg) {
    charImg     = new Image();
    charImg.src = 'assets/character.jpg';
  }

  score      = 0; speed = 4.5;
  playerLane = 1; targetLane = 1;
  playerX    = LANE_BOT[1];
  obstacles  = []; particles = [];
  roadOffset = 0; frameCount = 0;
  gameActive = true;
  document.getElementById('hud-score').textContent = '0';

  // Свайп-управление
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

  // Ускорение каждые 300 кадров
  if (frameCount % 300 === 0) speed = Math.min(speed + 0.5, 16);

  // Плавный переход между полосами
  playerX += (LANE_BOT[targetLane] - playerX) * 0.14;

  // Спавн препятствий
  const rate = Math.max(45, 140 - Math.floor(speed * 8));
  if (frameCount % rate === 0) {
    const lane = Math.floor(Math.random() * LANES);
    obstacles.push({ lane, y: VPY + 10 });
  }

  // Движение препятствий (нелинейное: ускоряются при приближении)
  obstacles.forEach(o => {
    const s = scaleAtY(o.y);
    o.y += speed * (0.8 + s * 2.2);
  });
  obstacles = obstacles.filter(o => o.y < H + 120);

  // Частицы
  particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life--; });
  particles = particles.filter(p => p.life > 0);

  // Столкновения
  for (const o of obstacles) {
    if (o.lane !== targetLane) continue;
    const oy = o.y;
    if (oy > GROUND_Y - 40 && oy < GROUND_Y + 70) {
      const ox = laneXatY(o.lane, oy);
      const px = playerX;
      if (Math.abs(ox - px) < W * 0.12) {
        explode(px, GROUND_Y);
        gameActive = false;
        tg.HapticFeedback?.notificationOccurred('error');
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
  // Сортируем препятствия по Y (сначала дальние)
  [...obstacles].sort((a,b) => a.y - b.y).forEach(drawBattery);
  drawParticles();
  if (gameActive) drawPlayer();
}

// ── Небо и горизонт ─────────────────────────────────────
function drawSky() {
  // Фон неба
  const sky = ctx.createLinearGradient(0, 0, 0, VPY);
  sky.addColorStop(0,   '#05051a');
  sky.addColorStop(1,   '#0f0f3a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, VPY + 4);

  // Звёзды (статичные, генерируются один раз)
  if (!drawSky._stars) {
    drawSky._stars = Array.from({length: 60}, () => ({
      x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.2, a: 0.3 + Math.random() * 0.7
    }));
  }
  drawSky._stars.forEach(s => {
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * VPY * 0.85, s.r, 0, Math.PI*2);
    const twinkle = s.a * (0.7 + Math.sin(frameCount * 0.03 + s.x * 10) * 0.3);
    ctx.fillStyle = `rgba(255,255,255,${twinkle})`;
    ctx.fill();
  });

  // Силуэт города на горизонте
  drawCitySilhouette();

  // Свечение горизонта
  const glow = ctx.createLinearGradient(0, VPY - 30, 0, VPY + 20);
  glow.addColorStop(0,   'rgba(230,92,0,0)');
  glow.addColorStop(0.5, 'rgba(230,92,0,0.25)');
  glow.addColorStop(1,   'rgba(230,92,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, VPY - 30, W, 50);
}

function drawCitySilhouette() {
  if (!drawCitySilhouette._data) {
    // Случайные здания
    const builds = [];
    for (let x = 0; x < W; x += W * 0.06) {
      builds.push({ x, w: W * 0.055, h: VPY * (0.3 + Math.random() * 0.65) });
    }
    drawCitySilhouette._data = builds;
  }
  ctx.fillStyle = '#090924';
  drawCitySilhouette._data.forEach(b => {
    ctx.fillRect(b.x, VPY - b.h, b.w - 1, b.h);
    // Окна
    for (let wy = VPY - b.h + 5; wy < VPY - 4; wy += 8) {
      for (let wx = b.x + 3; wx < b.x + b.w - 5; wx += 7) {
        if (Math.random() > 0.45) {
          ctx.fillStyle = `rgba(255,230,100,${0.15 + Math.random() * 0.35})`;
          ctx.fillRect(wx, wy, 4, 5);
          ctx.fillStyle = '#090924';
        }
      }
    }
  });
}

// ── Дорога с перспективой ───────────────────────────────
function drawRoad() {
  // Асфальт
  const road = ctx.createLinearGradient(0, VPY, 0, H);
  road.addColorStop(0,   '#14142a');
  road.addColorStop(0.4, '#1a1a32');
  road.addColorStop(1,   '#0d0d1e');
  ctx.fillStyle = road;
  ctx.beginPath();
  ctx.moveTo(VPX, VPY);
  ctx.lineTo(0, H);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Боковые полосы (разметка)
  const edgesBot = [0, W];
  edgesBot.forEach(ex => {
    const grad = ctx.createLinearGradient(0, VPY, 0, H);
    grad.addColorStop(0, 'rgba(230,92,0,0)');
    grad.addColorStop(0.5, 'rgba(230,92,0,0.35)');
    grad.addColorStop(1, 'rgba(230,92,0,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.moveTo(VPX, VPY);
    ctx.lineTo(ex, H);
    ctx.stroke();
  });

  // Пунктирные разделители полос
  const dividers = [
    { bot: (LANE_BOT[0] + LANE_BOT[1]) / 2 },
    { bot: (LANE_BOT[1] + LANE_BOT[2]) / 2 },
  ];

  ctx.setLineDash([22, 22]);
  ctx.lineWidth = 2;
  dividers.forEach(d => {
    // Рисуем делитель как набор отрезков с правильным смещением
    for (let y = VPY; y < H; y += 44) {
      const dashOffset = (roadOffset * 2) % 44;
      const y1 = y - dashOffset, y2 = Math.min(y1 + 22, H);
      if (y2 <= VPY) continue;
      const x1 = VPX + (d.bot - VPX) * Math.max(0, (y1 - VPY) / (ROAD_BOT_Y - VPY));
      const x2 = VPX + (d.bot - VPX) * Math.max(0, (y2 - VPY) / (ROAD_BOT_Y - VPY));
      const alpha = Math.max(0, (y1 - VPY) / (H - VPY)) * 0.5;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  });
  ctx.setLineDash([]);

  // Центральная линия (жёлтая)
  for (let y = VPY; y < H; y += 50) {
    const y1 = y - (roadOffset % 50), y2 = Math.min(y1 + 24, H);
    if (y2 <= VPY) continue;
    const x1 = VPX + (LANE_BOT[1] - VPX) * Math.max(0,(y1-VPY)/(ROAD_BOT_Y-VPY));
    const x2 = VPX + (LANE_BOT[1] - VPX) * Math.max(0,(y2-VPY)/(ROAD_BOT_Y-VPY));
    const alpha = Math.max(0,(y1-VPY)/(H-VPY)) * 0.3;
    ctx.strokeStyle = `rgba(255,190,0,${alpha})`;
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }

  // Подсветка текущей полосы
  const lx = laneXatY(targetLane, GROUND_Y);
  const laneGlow = ctx.createRadialGradient(lx, GROUND_Y, 0, lx, GROUND_Y, W * 0.22);
  laneGlow.addColorStop(0,   'rgba(230,92,0,0.14)');
  laneGlow.addColorStop(1,   'transparent');
  ctx.fillStyle = laneGlow;
  ctx.fillRect(0, VPY, W, H - VPY);
}

// ── Персонаж ────────────────────────────────────────────
function drawPlayer() {
  const x    = playerX;
  const y    = GROUND_Y;
  // Размер персонажа у земли
  const pw   = Math.min(W * 0.22, 110);
  const ph   = pw * 1.65;
  // Лёгкое покачивание
  const bob  = Math.sin(frameCount * 0.18) * 3.5;
  // Наклон при смене полосы
  const tilt = (LANE_BOT[targetLane] - playerX) / (W * 0.3) * 0.18;

  // Тень под персонажем
  const shadowGrad = ctx.createRadialGradient(x, y + 10, 2, x, y + 10, pw * 0.65);
  shadowGrad.addColorStop(0, 'rgba(0,0,0,0.55)');
  shadowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = shadowGrad;
  ctx.beginPath();
  ctx.ellipse(x, y + 12, pw * 0.6, pw * 0.16, 0, 0, Math.PI*2);
  ctx.fill();

  if (charImg && charImg.complete && charImg.naturalWidth > 0) {
    // Спрайт-лист: 3 столбца × 2 строки (FRONT|3/4|SIDE / BACK|RUN|JUMP)
    const COLS = 3, ROWS = 2;
    const sw = charImg.naturalWidth  / COLS;
    const sh = charImg.naturalHeight / ROWS * 0.85; // обрезаем подпись снизу

    // Чередуем RUN (col=1) и JUMP (col=2) для анимации бега
    const frame = Math.floor(frameCount / 9) % 2;
    const srcX  = sw * (1 + frame);
    const srcY  = charImg.naturalHeight / ROWS;

    ctx.save();
    ctx.translate(x, y - ph/2 + bob);
    ctx.rotate(tilt);
    // Рисуем персонажа напрямую — тёмный фон спрайта сливается с тёмным фоном игры
    ctx.drawImage(charImg, srcX, srcY, sw, sh, -pw/2, 0, pw, ph);
    ctx.restore();
  } else {
    // Fallback: простой прямоугольник
    ctx.save();
    ctx.translate(x, y - ph/2 + bob);
    ctx.rotate(tilt);
    const fg = ctx.createLinearGradient(0, 0, 0, ph);
    fg.addColorStop(0, '#ff6b35');
    fg.addColorStop(1, '#e65c00');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.roundRect(-pw/2, 0, pw, ph, 12);
    ctx.fill();
    ctx.font         = `${pw*0.5}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💨', 0, ph/2);
    ctx.restore();
  }
}

// ── Батарейка-препятствие (3D canvas) ───────────────────
function drawBattery(o) {
  const sc  = scaleAtY(o.y);
  const ox  = laneXatY(o.lane, o.y);
  const oy  = o.y;

  const bw  = W * 0.18 * sc;   // ширина батарейки
  const bh  = bw * 0.5;        // высота
  const tw  = bw * 0.1;        // клемма
  const r   = bw * 0.06;       // скругление
  const pulse = 0.5 + Math.sin(frameCount * 0.13 + oy * 0.01) * 0.5;

  ctx.save();
  ctx.translate(ox, oy);

  // Свечение вокруг
  ctx.shadowColor = `rgba(231,76,60,${0.7 * pulse * sc})`;
  ctx.shadowBlur  = 18 * sc;

  // ── Корпус (3D градиент) ─────────────────────────────
  const bodyGrad = ctx.createLinearGradient(-bw/2, -bh/2, -bw/2, bh/2);
  bodyGrad.addColorStop(0,   '#3d1a1a');
  bodyGrad.addColorStop(0.4, '#2a0f0f');
  bodyGrad.addColorStop(1,   '#1a0808');
  ctx.fillStyle   = bodyGrad;
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth   = 1.5 * sc;
  ctx.beginPath();
  ctx.roundRect(-bw/2, -bh/2, bw - tw, bh, r);
  ctx.fill(); ctx.stroke();

  // ── Верхняя грань (блик) ─────────────────────────────
  ctx.fillStyle = 'rgba(255,100,80,0.18)';
  ctx.beginPath();
  ctx.roundRect(-bw/2 + 2, -bh/2 + 2, bw - tw - 4, bh * 0.35, r * 0.5);
  ctx.fill();

  // ── Клемма ──────────────────────────────────────────
  const tGrad = ctx.createLinearGradient(bw/2 - tw, 0, bw/2, 0);
  tGrad.addColorStop(0, '#c0392b');
  tGrad.addColorStop(1, '#e74c3c');
  ctx.fillStyle = tGrad;
  ctx.beginPath();
  ctx.roundRect(bw/2 - tw, -bh * 0.2, tw - 1, bh * 0.4, 2);
  ctx.fill();

  // ── Индикатор уровня (почти пустой, красный) ─────────
  const iw = (bw - tw - 10) * 0.07;
  ctx.fillStyle = '#e74c3c';
  ctx.shadowBlur = 6 * sc;
  ctx.shadowColor = '#e74c3c';
  ctx.beginPath();
  ctx.roundRect(-bw/2 + 5, -bh/2 + 5, Math.max(iw, 4), bh - 10, 2);
  ctx.fill();

  // ── Символ ⚡ зачёркнутый ─────────────────────────────
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = '#e74c3c';
  ctx.font        = `bold ${bw * 0.36}px sans-serif`;
  ctx.textAlign   = 'center';
  ctx.textBaseline= 'middle';
  ctx.fillText('!', 0, 0);

  // ── X - зачёркивание ────────────────────────────────
  ctx.strokeStyle = 'rgba(231,76,60,0.7)';
  ctx.lineWidth   = 1.5 * sc;
  const xs = bw * 0.1;
  ctx.beginPath();
  ctx.moveTo(-xs, -xs * 0.8); ctx.lineTo(xs, xs * 0.8);
  ctx.moveTo(xs,  -xs * 0.8); ctx.lineTo(-xs, xs * 0.8);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ── Частицы взрыва ──────────────────────────────────────
function explode(x, y) {
  const colors = ['#ff6b35','#ffbe00','#e74c3c','#ffffff','#ff9a56'];
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
    particles.push({
      x, y,
      vx: Math.cos(a)*s, vy: Math.sin(a)*s - 2,
      life: 30 + Math.floor(Math.random()*20),
      color: colors[Math.floor(Math.random()*colors.length)],
      r: 2 + Math.random()*5,
    });
  }
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = p.life / 50;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ─── Конец игры ─────────────────────────────────────────
function endGame() {
  cancelAnimationFrame(animFrame);
  saveBest(score);
  document.getElementById('go-score').textContent = score;
  document.getElementById('go-best').textContent  = getBest();
  document.getElementById('btn-retry').onclick    = startGame;
  showScreen('s-over');
}

// ─── Старт ──────────────────────────────────────────────
initStart();
showScreen('s-start');
