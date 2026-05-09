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
  } catch (e) {
    console.warn("registerPromoCode failed", e);
  }
}

async function addCoinsToBalance(smokeCount) {
  if (!TG_UID || smokeCount <= 0) return;
  try {
    await fetch(`${BASE_URL}/api/add-coins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: TG_UID, smoke: smokeCount }),
    });
  } catch (e) {
    console.warn("addCoinsToBalance failed", e);
  }
}

// ─── Сторадж ────────────────────────────────────────────
const genCode      = p  => p + '-' + Math.random().toString(36).slice(2,8).toUpperCase();
const todayKey     = () => new Date().toISOString().slice(0,10);
const hasSpun      = () => localStorage.getItem('vr_spin_date') === todayKey();
const markSpun     = (id, code) => {
  localStorage.setItem('vr_spin_date', todayKey());
  localStorage.setItem('vr_last_prize', JSON.stringify({ id, code }));
};
const getBest      = () => parseInt(localStorage.getItem('vr_best') || '0');
const saveBest     = s  => { if (s > getBest()) localStorage.setItem('vr_best', s); };
const getTotalCoins = () => parseInt(localStorage.getItem('vr_coins') || '0');
const saveTotalCoins = n => localStorage.setItem('vr_coins', getTotalCoins() + n);

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
  const pad  = 34;                             // отступ под рамку
  const size = Math.min(window.innerWidth * 0.80, 300);
  const wc   = document.getElementById('wheelCanvas');
  wc.width = wc.height = size + pad * 2;       // canvas больше колеса
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
  const r    = cx - pad - 2;                  // радиус колеса
  const arc  = (Math.PI * 2) / PRIZES.length;
  wctx.clearRect(0, 0, wc.width, wc.height);

  // ── Сегменты ──────────────────────────────────────────
  PRIZES.forEach((p, i) => {
    const s = angle + arc * i - Math.PI / 2, e = s + arc;
    wctx.beginPath(); wctx.moveTo(cx, cy); wctx.arc(cx, cy, r, s, e); wctx.closePath();
    wctx.fillStyle   = p.color; wctx.fill();
    wctx.strokeStyle = 'rgba(0,0,0,0.25)'; wctx.lineWidth = 1.5; wctx.stroke();

    // Текст сегмента
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
    // Эмодзи у центра
    wctx.font = `${Math.round(wc.width * 0.052)}px serif`;
    wctx.shadowBlur = 0;
    wctx.textAlign = 'left';
    wctx.fillText(p.emoji, 14, wc.width * 0.018);
    wctx.restore();
  });

  // ── Внутреннее кольцо (тонкий разделитель) ───────────
  wctx.beginPath(); wctx.arc(cx, cy, r, 0, Math.PI * 2);
  wctx.strokeStyle = 'rgba(255,255,255,0.15)'; wctx.lineWidth = 2; wctx.stroke();

  // ── Определяем текущий сегмент под указателем ─────────
  const normalizedAngle = ((-angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const currentSeg      = Math.floor(normalizedAngle / arc) % PRIZES.length;
  const segStart        = angle + arc * currentSeg - Math.PI / 2;
  const segEnd          = segStart + arc;

  // ── Внешняя декоративная рамка ────────────────────────
  const fR = r + 10;    // радиус основной рамки
  const fR2 = r + 22;   // радиус внешней окантовки

  // Золотая рамка (градиент)
  const fGrad = wctx.createConicalGradient
    ? wctx.createConicalGradient(cx, cy, 0)   // если поддерживается
    : null;

  // Универсальный вариант — линейный градиент поверх кольца
  wctx.beginPath(); wctx.arc(cx, cy, fR, 0, Math.PI * 2);
  wctx.strokeStyle = 'rgba(255,190,0,0.55)'; wctx.lineWidth = 5; wctx.stroke();

  wctx.beginPath(); wctx.arc(cx, cy, fR2, 0, Math.PI * 2);
  wctx.strokeStyle = 'rgba(200,140,0,0.30)'; wctx.lineWidth = 3; wctx.stroke();

  // Засечки у каждой границы сегментов (как делённая шкала)
  for (let i = 0; i < PRIZES.length; i++) {
    const tickA = angle + arc * i - Math.PI / 2;
    const x1 = cx + Math.cos(tickA) * (r - 1);
    const y1 = cy + Math.sin(tickA) * (r - 1);
    const x2 = cx + Math.cos(tickA) * (fR2 + 6);
    const y2 = cy + Math.sin(tickA) * (fR2 + 6);
    wctx.strokeStyle = 'rgba(255,220,80,0.7)'; wctx.lineWidth = 2;
    wctx.beginPath(); wctx.moveTo(x1, y1); wctx.lineTo(x2, y2); wctx.stroke();
    // Маленький ромб на конце засечки
    wctx.fillStyle = '#ffcf40';
    wctx.beginPath(); wctx.arc(x2, y2, 3.5, 0, Math.PI * 2); wctx.fill();
  }

  // ── Подсветка активного сегмента на рамке ─────────────
  wctx.save();
  wctx.shadowColor = 'rgba(255,240,80,1)';
  wctx.shadowBlur  = 18;
  wctx.beginPath();
  wctx.arc(cx, cy, fR, segStart, segEnd);
  wctx.strokeStyle = 'rgba(255,240,100,0.95)';
  wctx.lineWidth   = 7;
  wctx.stroke();
  wctx.restore();

  // ── Центральная шляпка ────────────────────────────────
  wctx.beginPath(); wctx.arc(cx, cy, 24, 0, Math.PI * 2);
  const hubGrad = wctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, 24);
  hubGrad.addColorStop(0,   '#ffcf40');
  hubGrad.addColorStop(0.5, '#e65c00');
  hubGrad.addColorStop(1,   '#7a2d00');
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
      // Регистрируем промокод на сервере чтобы бот мог его принять
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
  VPY        = H * 0.26;           // горизонт ниже → дорога шире
  GROUND_Y   = H * 0.80;           // Y игрока
  ROAD_BOT_Y = H * 1.08;
  // Широкое расположение полос (было 20/50/80, теперь 12/50/88)
  LANE_BOT   = [W * 0.12, W * 0.50, W * 0.88];
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
let canvas, ctx;
let score, speed, playerLane, targetLane, playerX;
let obstacles, rings, particles, roadOffset, frameCount;
let coins;           // монеты текущего забега
let animFrame, gameActive;

function startGame() {
  showScreen('s-game');
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  setupDims();

  // processedChar загружается заранее — ничего делать не нужно

  score      = 0; speed = 3.0;
  playerLane = 1; targetLane = 1;
  playerX    = LANE_BOT[1];
  obstacles  = []; rings = []; particles = [];
  coins      = 0;
  roadOffset = 0; frameCount = 0;
  gameActive = true;
  document.getElementById('hud-score').textContent  = '0';
  document.getElementById('hud-coins').textContent  = '🌀 0';

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

  // Плавное ускорение каждые 400 кадров (~6 сек при 60fps)
  if (frameCount % 400 === 0) speed = Math.min(speed + 0.35, 14);

  // Плавный переход между полосами
  playerX += (LANE_BOT[targetLane] - playerX) * 0.17;

  // Спавн препятствий — плавный и предсказуемый
  const rate = Math.max(50, 160 - Math.floor(speed * 9));
  if (frameCount % rate === 0) {
    const lane = Math.floor(Math.random() * LANES);
    const recent = obstacles.filter(o => o.lane === lane && o.y < VPY + H * 0.3);
    if (recent.length === 0) {
      obstacles.push({ lane, y: VPY + 10 });
    }
  }

  // Спавн колечек дыма — каждые ~90 кадров, не совпадают с препятствиями
  const ringRate = Math.max(55, 110 - Math.floor(speed * 4));
  if (frameCount % ringRate === 0) {
    const lane = Math.floor(Math.random() * LANES);
    // Не спавним кольцо туда, где сейчас идёт препятствие
    const blocked = obstacles.some(o => o.lane === lane && o.y < VPY + H * 0.5 && o.y > VPY + 5);
    if (!blocked) {
      // Иногда — пачка из 3 колец в ряд
      const count = Math.random() < 0.35 ? 3 : 1;
      for (let k = 0; k < count; k++) {
        rings.push({ lane, y: VPY + 10 + k * 40 });
      }
    }
  }

  // Движение препятствий (нелинейное: ускоряются при приближении)
  obstacles.forEach(o => {
    const s = scaleAtY(o.y);
    o.y += speed * (0.8 + s * 2.2);
  });
  obstacles = obstacles.filter(o => o.y < H + 120);

  // Движение колечек (та же физика)
  rings.forEach(r => {
    const s = scaleAtY(r.y);
    r.y += speed * (0.8 + s * 2.2);
  });
  rings = rings.filter(r => r.y < H + 60);

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
  // Сортируем по Y (дальние сначала): и препятствия, и кольца
  [...rings].sort((a,b) => a.y - b.y).forEach(drawRing);
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
  ctx.lineTo(-W * 0.08, H);   // немного за левый край
  ctx.lineTo(W * 1.08, H);    // немного за правый край
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

// ── Персонаж ─────────────────────────────────────────────
function drawPlayer() {
  const x    = playerX;
  const y    = GROUND_Y;
  const pw   = Math.min(W * 0.22, 100);
  const ph   = pw * 2.0;
  const bob  = Math.sin(frameCount * 0.16) * 4 + Math.sin(frameCount * 0.3) * 1.5;
  const tilt = (LANE_BOT[targetLane] - playerX) / (W * 0.35) * 0.10;

  // Тень под ногами
  const sg = ctx.createRadialGradient(x, y + 8, 1, x, y + 8, pw * 0.55);
  sg.addColorStop(0, 'rgba(0,0,0,0.65)'); sg.addColorStop(1, 'transparent');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.ellipse(x, y + 10, pw * 0.50, pw * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  drawVapeCharacter(x, y, pw, ph, bob, tilt);
}

/**
 * Рисует вайп-маскота canvas-примитивами.
 * Намеренно не использует roundRect с массивом радиусов
 * (для совместимости с полифиллом).
 */
function drawVapeCharacter(cx, cy, pw, ph, bob, tilt) {
  const run  = Math.sin(frameCount * 0.32);   // -1…+1, фаза бега
  const run2 = Math.sin(frameCount * 0.32 + Math.PI); // противофаза

  ctx.save();
  // Начало координат — центр низа персонажа
  ctx.translate(cx, cy + bob);
  ctx.rotate(tilt);

  // ─── Размеры ────────────────────────────────────────────
  const legH   = ph * 0.30;                 // длина ноги
  const bodyH  = ph * 0.44;                 // высота тела
  const headR  = pw * 0.26;                 // радиус головы
  const bodyW  = pw * 0.68;                 // ширина тела
  const bodyX  = -bodyW / 2;
  const bodyY  = -(legH + bodyH);           // верх тела (относит. cy)
  const headY  = bodyY - headR * 1.05;      // центр головы
  const bodyBR = bodyW * 0.14;              // скругление тела

  // ─── Ноги ──────────────────────────────────────────────
  const legOffX = bodyW * 0.20;
  const legW    = pw * 0.09;
  const shoeRx  = pw * 0.13, shoeRy = pw * 0.065;

  [[-legOffX, '#f06292', run * 0.40],
   [ legOffX, '#26c6da', run2 * 0.40]].forEach(([lx, col, angle]) => {
    ctx.save();
    ctx.translate(lx, -legH);
    ctx.rotate(angle);
    // Нога
    ctx.strokeStyle = col; ctx.lineWidth = legW; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, legH * 0.92); ctx.stroke();
    // Кроссовок
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(shoeRx * 0.45, legH * 0.92, shoeRx, shoeRy, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  });

  // ─── Тело ──────────────────────────────────────────────
  // Градиент слева (розовый) → справа (голубой)
  const bodyGrad = ctx.createLinearGradient(bodyX, 0, bodyX + bodyW, 0);
  bodyGrad.addColorStop(0,    '#f06292');
  bodyGrad.addColorStop(0.48, '#e91e8c');
  bodyGrad.addColorStop(0.52, '#26c6da');
  bodyGrad.addColorStop(1,    '#00acc1');

  ctx.shadowColor = 'rgba(240,98,146,0.55)';
  ctx.shadowBlur  = 14;
  ctx.beginPath();
  ctx.roundRect(bodyX, bodyY, bodyW, bodyH, bodyBR);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Обводка
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.roundRect(bodyX, bodyY, bodyW, bodyH, bodyBR); ctx.stroke();

  // Вертикальная линия раздела цветов
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, bodyY + 5); ctx.lineTo(0, bodyY + bodyH - 5); ctx.stroke();

  // Блик (верхняя полоса)
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.beginPath();
  ctx.roundRect(bodyX + 3, bodyY + 4, bodyW - 6, bodyH * 0.26, bodyBR * 0.5);
  ctx.fill();

  // Небольшие кнопки/детали
  [-bodyW * 0.28, bodyW * 0.28].forEach((bx2, i) => {
    ctx.fillStyle = i === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(0,200,220,0.35)';
    ctx.beginPath();
    ctx.arc(bx2, bodyY + bodyH * 0.72, pw * 0.055, 0, Math.PI * 2);
    ctx.fill();
  });

  // ─── Руки ──────────────────────────────────────────────
  const armY   = bodyY + bodyH * 0.30;
  const armLen = pw * 0.30;
  const armW2  = pw * 0.085;
  const glvR   = pw * 0.095;

  [[-bodyW / 2, '#f06292', run2 * 0.44,  -1],   // левая рука — противофаза левой ноги
   [ bodyW / 2, '#26c6da', run * 0.44,    1]].forEach(([ax, col, angle, dir]) => {
    ctx.save();
    ctx.translate(ax, armY);
    ctx.rotate(angle);
    ctx.strokeStyle = col; ctx.lineWidth = armW2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dir * armLen * 0.72, armLen * 0.58); ctx.stroke();
    // Перчатка
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(dir * armLen * 0.72, armLen * 0.58, glvR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  });

  // ─── Голова ─────────────────────────────────────────────
  // Голова — сфера с розово-голубым градиентом
  const headGrad = ctx.createRadialGradient(-headR * 0.25, headY - headR * 0.25, headR * 0.1,
                                              0, headY, headR);
  headGrad.addColorStop(0, '#ff9fc8');
  headGrad.addColorStop(0.55, '#f06292');
  headGrad.addColorStop(1, '#c2185b');

  ctx.shadowColor = 'rgba(240,98,146,0.4)'; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fillStyle = headGrad; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
  ctx.stroke();

  // Антенна / мундштук
  ctx.strokeStyle = '#f48fb1'; ctx.lineWidth = pw * 0.055; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, headY - headR); ctx.lineTo(0, headY - headR * 1.55); ctx.stroke();
  // Пар из антенны
  for (let p = 0; p < 3; p++) {
    const vx  = Math.sin(frameCount * 0.07 + p * 2.0) * 7;
    const vy  = headY - headR * 1.6 - p * 11;
    const vr  = 3.5 + p * 3;
    const va  = (0.28 - p * 0.08) * (0.5 + Math.sin(frameCount * 0.09 + p) * 0.35);
    ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(190,220,255,${va.toFixed(2)})`; ctx.fill();
  }

  // ─── Лицо ──────────────────────────────────────────────
  const ew = headR * 0.32;
  const ey = headY;

  // Белки глаз
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.ellipse(-headR * 0.40, ey, ew, ew * 0.82, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.ellipse( headR * 0.40, ey, ew, ew * 0.82, 0, 0, Math.PI * 2); ctx.fill();

  // Зрачки
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath(); ctx.arc(-headR * 0.37 + 2, ey + 1, ew * 0.50, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( headR * 0.37 + 2, ey + 1, ew * 0.50, 0, Math.PI * 2); ctx.fill();

  // Блики на зрачках
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(-headR * 0.35 + 3, ey - 1.5, ew * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc( headR * 0.35 + 3, ey - 1.5, ew * 0.17, 0, Math.PI * 2); ctx.fill();

  // Улыбка
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, ey + ew * 1.25, headR * 0.28, 0.25, Math.PI - 0.25);
  ctx.stroke();

  ctx.restore();
}

// ── Колечко дыма (собираемый объект) ────────────────────
function drawRing(ring) {
  const sc  = scaleAtY(ring.y);
  const rx  = laneXatY(ring.lane, ring.y);
  const floatH = 58 * sc;              // высота парения над дорогой
  const ry  = ring.y - floatH;

  const outerA = W * 0.038 * sc;      // полуось X внешнего кольца
  const outerB = outerA * 0.48;       // полуось Y (перспектива)
  const pulse  = 0.88 + Math.sin(frameCount * 0.11 + ring.y * 0.04) * 0.12;

  ctx.save();
  ctx.translate(rx, ry);
  ctx.scale(pulse, pulse);

  // Свечение
  ctx.shadowColor = 'rgba(140,230,255,0.9)';
  ctx.shadowBlur  = 12 * sc;

  // Внешнее кольцо
  ctx.beginPath();
  ctx.ellipse(0, 0, outerA, outerB, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(200,248,255,0.95)';
  ctx.lineWidth   = outerA * 0.22;
  ctx.stroke();

  // Внутренний блик
  ctx.beginPath();
  ctx.ellipse(0, 0, outerA * 0.55, outerB * 0.55, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.38)';
  ctx.lineWidth   = outerA * 0.10;
  ctx.stroke();

  // Блик (дуга сверху-слева — имитация объёма)
  ctx.beginPath();
  ctx.ellipse(0, 0, outerA, outerB, 0, Math.PI * 1.15, Math.PI * 1.65);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth   = outerA * 0.14;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ── Искры при сборе колечка ──────────────────────────────
function sparkleRing(x, y) {
  const colors = ['#a0eeff', '#ffffff', '#80d8ff', '#b3f0ff', '#e0f7ff'];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const s = 1.5 + Math.random() * 3.5;
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 2,
      life: 18 + Math.floor(Math.random() * 12),
      color: colors[Math.floor(Math.random() * colors.length)],
      r: 1.5 + Math.random() * 2.5,
    });
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
