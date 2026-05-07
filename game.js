"use strict";

// ─── Telegram ────────────────────────────────────────────
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// ─── Полифилл roundRect (старые WebView) ─────────────────
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
  { id: 'disc10', label: 'Скидка\n10%',        emoji: '🎫', color: '#c0392b', isPromo: true,  prefix: 'VAPE10' },
  { id: 'liquid', label: 'Любая\nжидкость',    emoji: '💧', color: '#2980b9', isPromo: false },
  { id: 'disc5',  label: 'Скидка\n5%',         emoji: '🎫', color: '#d35400', isPromo: true,  prefix: 'VAPE5'  },
  { id: 'disp',   label: 'Одноразка\n2500 тяг',emoji: '🔥', color: '#8e44ad', isPromo: false },
  { id: 'points', label: '+500\nбаллов',       emoji: '⭐', color: '#27ae60', isPromo: false },
  { id: 'coal',   label: 'Уголь для\nкальяна', emoji: '🪨', color: '#616a6b', isPromo: false },
];

const PRIZE_TEXTS = {
  disc10:  'Скидка 10% на следующий заказ!',
  disc5:   'Скидка 5% на следующий заказ!',
  points:  '+500 бонусных баллов на счёт!',
  disp:    'Любая одноразка до 2500 затяжек — бесплатно!',
  liquid:  'Любая жидкость — бесплатно!',
  coal:    'Уголь для кальяна — бесплатно!',
};

// ─── Утилиты ────────────────────────────────────────────
function genCode(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function hasSpunToday() {
  return localStorage.getItem('vr_spin_date') === todayKey();
}
function markSpun(prizeId, code) {
  localStorage.setItem('vr_spin_date', todayKey());
  localStorage.setItem('vr_last_prize', JSON.stringify({ prizeId, code, date: todayKey() }));
}
function getBest() { return parseInt(localStorage.getItem('vr_best') || '0'); }
function saveBest(s) { if (s > getBest()) localStorage.setItem('vr_best', s); }

// ─── Навигация ───────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ─── СТАРТ-ЭКРАН ─────────────────────────────────────────
function initStart() {
  const best = getBest();
  document.getElementById('best-display').textContent = best > 0 ? `🏆 Рекорд: ${best}` : '';

  const wheelBtn    = document.getElementById('btn-wheel');
  const cooldownEl  = document.getElementById('wheel-cooldown');

  if (hasSpunToday()) {
    wheelBtn.disabled = true;
    wheelBtn.textContent = '✅ Уже крутили сегодня';
    const now      = new Date();
    const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    const diff = midnight - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    document.getElementById('next-spin').textContent = `${h}ч ${m}мин`;
    cooldownEl.classList.remove('hidden');
  } else {
    wheelBtn.disabled = false;
    wheelBtn.textContent = '🎰 Крутить колесо';
    cooldownEl.classList.add('hidden');
  }

  document.getElementById('btn-play').onclick    = startGame;
  document.getElementById('btn-wheel').onclick   = () => { initWheel(); showScreen('s-wheel'); };
}

// ─── КОЛЕСО ФОРТУНЫ ──────────────────────────────────────
let wheelAngle = 0;
let spinning   = false;

function initWheel() {
  const size = Math.min(window.innerWidth * 0.82, 310);
  const wc   = document.getElementById('wheelCanvas');
  wc.width   = size;
  wc.height  = size;
  drawWheel(wheelAngle);

  const btn = document.getElementById('btn-spin');
  if (hasSpunToday()) {
    btn.disabled    = true;
    btn.textContent = 'Уже крутили';
  } else {
    btn.disabled    = false;
    btn.textContent = 'Крутить!';
    btn.onclick     = spinWheel;
  }
}

function drawWheel(angle) {
  const wc  = document.getElementById('wheelCanvas');
  const ctx = wc.getContext('2d');
  const cx  = wc.width  / 2;
  const cy  = wc.height / 2;
  const r   = cx - 6;
  const N   = PRIZES.length;
  const arc = (Math.PI * 2) / N;

  ctx.clearRect(0, 0, wc.width, wc.height);

  PRIZES.forEach((p, i) => {
    const start = angle + arc * i - Math.PI / 2;
    const end   = start + arc;

    // Сегмент
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Текст на сегменте
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + arc / 2);
    ctx.textAlign    = 'right';
    ctx.fillStyle    = 'rgba(255,255,255,0.95)';
    ctx.font         = `bold ${Math.round(wc.width * 0.038)}px sans-serif`;
    ctx.shadowColor  = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur   = 3;
    const lines = p.label.split('\n');
    lines.forEach((line, li) => {
      const lineH = wc.width * 0.042;
      ctx.fillText(line, r - 10, (li - (lines.length - 1) / 2) * lineH);
    });
    ctx.restore();
  });

  // Внешнее кольцо
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,190,0,0.5)';
  ctx.lineWidth   = 3;
  ctx.stroke();

  // Центральный кружок
  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  ctx.fillStyle   = '#07071a';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,190,0,0.6)';
  ctx.lineWidth   = 2;
  ctx.stroke();

  ctx.font          = '16px serif';
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'middle';
  ctx.shadowBlur    = 0;
  ctx.fillText('💨', cx, cy);
}

function spinWheel() {
  if (spinning || hasSpunToday()) return;
  spinning = true;
  document.getElementById('btn-spin').disabled = true;

  const winIdx = Math.floor(Math.random() * PRIZES.length);
  const N   = PRIZES.length;
  const arc = (Math.PI * 2) / N;

  // Целевой угол: указатель (верх = -π/2) смотрит на середину сегмента winIdx
  const finalAngle = -(arc * winIdx + arc / 2);
  const diff       = ((finalAngle - wheelAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const totalSpin  = diff + Math.PI * 2 * (6 + Math.floor(Math.random() * 3));

  const duration   = 5000;
  const startTime  = performance.now();
  const startAngle = wheelAngle;

  function animate(now) {
    const t    = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 4); // ease-out quart
    wheelAngle = startAngle + totalSpin * ease;
    drawWheel(wheelAngle);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      spinning = false;
      const prize = PRIZES[winIdx];
      const code  = prize.isPromo ? genCode(prize.prefix) : null;
      markSpun(prize.id, code);
      showPrize(prize, code);
    }
  }
  requestAnimationFrame(animate);
}

function showPrize(prize, code) {
  document.getElementById('prize-emoji').textContent = prize.emoji;
  document.getElementById('prize-text').textContent  = PRIZE_TEXTS[prize.id] || prize.label.replace('\n', ' ');

  const codeBox  = document.getElementById('prize-code-box');
  const physBox  = document.getElementById('prize-physical');

  if (code) {
    document.getElementById('prize-code-val').textContent = code;
    codeBox.classList.remove('hidden');
    physBox.classList.add('hidden');
  } else {
    codeBox.classList.add('hidden');
    physBox.classList.remove('hidden');
  }

  document.getElementById('btn-play-after').onclick = startGame;
  showScreen('s-prize');
  tg.HapticFeedback?.notificationOccurred('success');
}

function copyCode() {
  const code = document.getElementById('prize-code-val').textContent;
  navigator.clipboard?.writeText(code).then(() => {
    const btn = document.getElementById('btn-copy');
    btn.textContent = '✅ Скопировано!';
    setTimeout(() => { btn.textContent = '📋 Скопировать'; }, 2000);
  }).catch(() => {
    tg.showAlert('Код: ' + code);
  });
}

// ─── ДВИЖОК ИГРЫ ────────────────────────────────────────
const LANES      = 3;
const HUD_H      = 44;  // высота HUD

let canvas, ctx, charImg;
let score, speed, playerLane, targetLane, playerX;
let obstacles, particles, bgOffset, frameCount;
let animFrame, gameActive;
let laneShake = 0;

function startGame() {
  showScreen('s-game');

  canvas        = document.getElementById('gameCanvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx           = canvas.getContext('2d');

  if (!charImg) {
    charImg     = new Image();
    charImg.src = 'assets/character.jpg';
  }

  score       = 0;
  speed       = 5;
  playerLane  = 1;
  targetLane  = 1;
  playerX     = laneX(1);
  obstacles   = [];
  particles   = [];
  bgOffset    = 0;
  frameCount  = 0;
  gameActive  = true;

  document.getElementById('hud-score').textContent = '0';

  // Управление: свайп
  let touchStartX = 0;
  let touchStartY = 0;
  canvas.ontouchstart = e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    e.preventDefault();
  };
  canvas.ontouchend = e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 25) {
      moveLane(dx < 0 ? -1 : 1);
    }
    e.preventDefault();
  };

  // Клавиатура (тест)
  document.onkeydown = e => {
    if (e.key === 'ArrowLeft')  moveLane(-1);
    if (e.key === 'ArrowRight') moveLane(1);
  };

  cancelAnimationFrame(animFrame);
  gameLoop();
}

function moveLane(dir) {
  const next = targetLane + dir;
  if (next >= 0 && next < LANES) {
    targetLane = next;
    tg.HapticFeedback?.selectionChanged();
  }
}

function laneX(lane) {
  const lw = canvas.width / LANES;
  return lw * lane + lw / 2;
}

function playerY() { return canvas.height * 0.74; }
function playerW()  { return canvas.width / 5.5; }

// ─── Основной цикл ──────────────────────────────────────
function gameLoop() {
  if (!gameActive) return;

  frameCount++;
  bgOffset = (bgOffset + speed * 0.6) % 100;
  score++;
  document.getElementById('hud-score').textContent = score;

  // Ускорение каждые 250 кадров
  if (frameCount % 250 === 0) speed = Math.min(speed + 0.6, 18);

  // Плавное движение по дорожкам
  playerX += (laneX(targetLane) - playerX) * 0.16;

  // Спавн препятствий
  const spawnRate = Math.max(40, 130 - Math.floor(speed * 6));
  if (frameCount % spawnRate === 0) {
    const lane = Math.floor(Math.random() * LANES);
    // Не спавним 2 одноразовых подряд на той же полосе
    const last = obstacles[obstacles.length - 1];
    if (!last || last.lane !== lane || last.y < -80) {
      obstacles.push({ lane, x: laneX(lane), y: -80, size: canvas.width / 6.5 });
    }
  }

  // Движение препятствий
  obstacles.forEach(o => o.y += speed * 1.8);
  obstacles = obstacles.filter(o => o.y < canvas.height + 100);

  // Частицы
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.life--;
    p.vy += 0.15;
  });
  particles = particles.filter(p => p.life > 0);

  // Коллизии
  const py  = playerY();
  const pw2 = playerW() * 0.42;
  for (const o of obstacles) {
    const dist = Math.hypot(o.x - playerX, o.y - py);
    if (dist < o.size * 0.48 + pw2 * 0.6) {
      spawnDeathParticles(playerX, py);
      gameActive = false;
      tg.HapticFeedback?.notificationOccurred('error');
      setTimeout(gameOver, 700);
      break;
    }
  }

  draw();
  animFrame = requestAnimationFrame(gameLoop);
}

function spawnDeathParticles(x, y) {
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 2 + Math.random() * 5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 2,
      life: 28 + Math.floor(Math.random() * 20),
      color: ['#ff6b35','#ffbe00','#e74c3c','#fff'][Math.floor(Math.random() * 4)],
      r: 2 + Math.random() * 4,
    });
  }
}

function resumeGame() {
  document.getElementById('pause-overlay').classList.add('hidden');
  gameActive = true;
  gameLoop();
}

// ─── Отрисовка ──────────────────────────────────────────
function draw() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  drawBackground(W, H);
  drawLanes(W, H);
  obstacles.forEach(o => drawBattery(o));
  drawParticles();
  if (gameActive) drawPlayer();
}

function drawBackground(W, H) {
  // Тёмный градиент
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#050518');
  grad.addColorStop(1, '#0a0a28');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Горизонтальные линии сетки (эффект движения)
  ctx.strokeStyle = 'rgba(230,92,0,0.08)';
  ctx.lineWidth   = 1;
  for (let y = bgOffset % 100; y < H; y += 100) {
    const prog = y / H;
    ctx.globalAlpha = prog * 0.7;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Боковые неоновые полосы
  const glowL = ctx.createLinearGradient(0, 0, 0, H);
  glowL.addColorStop(0, 'rgba(230,92,0,0)');
  glowL.addColorStop(0.5, 'rgba(230,92,0,0.15)');
  glowL.addColorStop(1, 'rgba(230,92,0,0)');
  ctx.fillStyle = glowL;
  ctx.fillRect(0, 0, 4, H);
  ctx.fillRect(W - 4, 0, 4, H);
}

function drawLanes(W, H) {
  const lw = W / LANES;

  // Разделители дорожек
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([18, 18]);
  ctx.lineDashOffset = -bgOffset * 2;

  for (let i = 1; i < LANES; i++) {
    const x = lw * i;
    ctx.beginPath(); ctx.moveTo(x, HUD_H); ctx.lineTo(x, H); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // Подсветка текущей дорожки
  const alpha = 0.05 + Math.sin(frameCount * 0.05) * 0.02;
  ctx.fillStyle = `rgba(230,92,0,${alpha})`;
  ctx.fillRect(targetLane * lw, HUD_H, lw, H - HUD_H);
}

function drawPlayer() {
  const x  = playerX;
  const y  = playerY();
  const pw = playerW();
  const ph = pw * 1.6;
  const bobY = Math.sin(frameCount * 0.18) * 3.5;

  if (charImg && charImg.complete && charImg.naturalWidth > 0) {
    // Берём позу RUN (столбец 1, строка 1 — нижний средний)
    const COLS = 3, ROWS = 2;
    const sw   = charImg.naturalWidth  / COLS;
    const sh   = charImg.naturalHeight / ROWS;

    ctx.save();
    // screen-режим делает чёрный фон прозрачным
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(
      charImg,
      sw * 1, sh * 1,   // RUN: col=1, row=1
      sw, sh,
      x - pw / 2, y - ph / 2 + bobY,
      pw, ph
    );
    ctx.restore();
  } else {
    // Fallback-персонаж
    ctx.fillStyle = '#e65c00';
    ctx.beginPath();
    ctx.roundRect(x - pw / 2, y - ph / 2 + bobY, pw, ph, 8);
    ctx.fill();
    ctx.font         = `${pw * 0.5}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💨', x, y + bobY);
  }

  // Тень под персонажем
  const shadowGrad = ctx.createRadialGradient(x, y + ph * 0.48, 0, x, y + ph * 0.48, pw * 0.6);
  shadowGrad.addColorStop(0, 'rgba(230,92,0,0.28)');
  shadowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = shadowGrad;
  ctx.beginPath();
  ctx.ellipse(x, y + ph * 0.48 + bobY, pw * 0.55, pw * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBattery(o) {
  const { x, y, size } = o;
  const bw   = size;
  const bh   = size * 0.52;
  const termW = bw * 0.1;
  const termH = bh * 0.38;
  const r    = 5;

  // Пульсирующее свечение
  const pulse = 0.6 + Math.sin(frameCount * 0.12 + y * 0.01) * 0.4;

  ctx.shadowColor = `rgba(231,76,60,${pulse * 0.8})`;
  ctx.shadowBlur  = 16;

  // Корпус
  ctx.fillStyle   = '#1e1e2e';
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - bh / 2, bw - termW, bh, r);
  ctx.fill();
  ctx.stroke();

  // Клемма
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.roundRect(x - bw / 2 + bw - termW, y - termH / 2, termW - 1, termH, 3);
  ctx.fill();

  // Красная полоска (почти пустая)
  const fillW = Math.max((bw - termW - 10) * 0.06, 4);
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.roundRect(x - bw / 2 + 5, y - bh / 2 + 5, fillW, bh - 10, 2);
  ctx.fill();

  // Иконка 🪫 по центру
  ctx.shadowBlur   = 0;
  ctx.font         = `${size * 0.42}px serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#fff';
  ctx.fillText('🪫', x - termW / 2, y);

  ctx.shadowBlur = 0;
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = p.life / 48;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ─── Конец игры ─────────────────────────────────────────
function gameOver() {
  cancelAnimationFrame(animFrame);
  saveBest(score);
  document.getElementById('go-score').textContent = score;
  document.getElementById('go-best').textContent  = getBest();
  document.getElementById('btn-retry').onclick    = startGame;
  showScreen('s-over');
}

// ─── Запуск ──────────────────────────────────────────────
initStart();
showScreen('s-start');
