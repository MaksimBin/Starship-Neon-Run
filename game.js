'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const audioEl = document.getElementById('bgAudio');

let DPR = Math.max(1, window.devicePixelRatio || 1);
function resizeCanvas() {
  const w = window.innerWidth, h = window.innerHeight;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.floor(w * DPR);
  canvas.height = Math.floor(h * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeCanvas();
    recalcScale();
  }, 100);
});
resizeCanvas();

/* Resources */
const playerSkin = new Image(); playerSkin.src = 'player.png';
const enemySkin = new Image(); enemySkin.src = 'enemy.png';
const blasterSound = new Audio('blaster.mp3'); blasterSound.preload = 'auto'; blasterSound.volume = 0.9;

let PARALLAX_TILE = { src1x: 'bg_tile.png', src2x: 'bg_tile@2x.png', img1x: null, img2x: null, use2x:false, ready:false };
const PARALLAX_SPEEDS = [0.03,0.07,0.14,0.28,0.6];
let PARALLAX_OFFSETS = [0,0,0,0,0];
const PARALLAX_SCROLL_SPEED = 0.06;

let starship = null;
let enemies = [];
let particles = [];
let bullets = [];
let timeSurvived = 0;
let gameRunning = false;
let lastTime = 0;
let spawnTimer = 0;
let spawnInterval = 900;
let scaleFactor = 1;

const PLAYER_BASE_W = 120;
const PLAYER_BASE_H = 160;
const ENEMY_BASE_R = 48;
const ENEMY_BASE_SPEED = 140;

let rafId = null;

/* Shooting config */
const SHOOT_COOLDOWN = 180; // ms
let lastShotAt = 0;
const BULLET_SPEED = 900; // px/s
const BULLET_RADIUS = 6;
const BULLET_COLOR = '#00ffd0';
const BULLET_LIFETIME = 2000; // ms

/* Helpers */
function recalcScale(){ scaleFactor = Math.max(0.6, Math.min(1.6, window.innerWidth / 900)); }

function preloadImagesSilent(list){
  return new Promise(resolve => {
    if (!list || list.length === 0) return resolve({ ok:true, failed:[] });
    let loaded = 0, failed = [];
    for (let src of list) {
      const img = new Image();
      img.onload = () => { loaded++; if (loaded + failed.length === list.length) resolve({ ok: failed.length===0, failed }); };
      img.onerror = () => { failed.push(src); loaded++; if (loaded + failed.length === list.length) resolve({ ok: failed.length===0, failed }); };
      img.src = src;
    }
  });
}

/* Parallax setup */
async function setupParallaxSingleTile(){
  PARALLAX_TILE.img1x = new Image();
  PARALLAX_TILE.img2x = new Image();
  const res1 = await preloadImagesSilent([PARALLAX_TILE.src1x]);
  if (!res1.ok) {
    PARALLAX_TILE.img1x.src = PARALLAX_TILE.src1x;
    PARALLAX_TILE.img2x.src = PARALLAX_TILE.src2x;
    PARALLAX_OFFSETS = PARALLAX_SPEEDS.map(()=>0);
    PARALLAX_TILE.ready = false;
    return;
  }
  PARALLAX_TILE.img1x.src = PARALLAX_TILE.src1x;
  PARALLAX_TILE.img2x.onload = () => { PARALLAX_TILE.use2x = true; PARALLAX_TILE.ready = true; };
  PARALLAX_TILE.img2x.onerror = () => {};
  PARALLAX_TILE.img2x.src = PARALLAX_TILE.src2x;
  await new Promise(r => setTimeout(r, 700));
  if (!PARALLAX_TILE.use2x) {
    if (PARALLAX_TILE.img1x.complete && PARALLAX_TILE.img1x.naturalWidth > 0) {
      PARALLAX_TILE.use2x = false;
      PARALLAX_TILE.ready = true;
    } else {
      PARALLAX_TILE.ready = false;
    }
  }
  PARALLAX_OFFSETS = PARALLAX_SPEEDS.map(()=>0);
}

/* Init game */
function initGame(){
  recalcScale();
  starship = {
    x: window.innerWidth / 2,
    y: window.innerHeight - 200 * scaleFactor,
    w: PLAYER_BASE_W * scaleFactor,
    h: PLAYER_BASE_H * scaleFactor
  };
  enemies.length = 0;
  particles.length = 0;
  bullets.length = 0;
  for (let i = 0; i < 40; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      len: (Math.random() * 20 + 10) * scaleFactor,
      speed: (Math.random() * 1.5 + 0.5) * scaleFactor,
      alpha: Math.random() * 0.5 + 0.2
    });
  }
  timeSurvived = 0;
  spawnTimer = 0;
  spawnInterval = 900;
  lastTime = performance.now();
  gameRunning = true;
  document.getElementById('hud').style.display = 'block';
}

/* Parallax render */
function renderParallax(dt){
  const canvasW = canvas.clientWidth;
  const canvasH = canvas.clientHeight;
  if (!PARALLAX_TILE.ready) {
    const g = ctx.createLinearGradient(0,0,0,canvasH);
    g.addColorStop(0,'#001217'); g.addColorStop(0.5,'#0b1a2b'); g.addColorStop(1,'#071018');
    ctx.fillStyle = g; ctx.fillRect(0,0,canvasW,canvasH); return;
  }
  const tileImg = (PARALLAX_TILE.use2x && PARALLAX_TILE.img2x && PARALLAX_TILE.img2x.complete && PARALLAX_TILE.img2x.naturalWidth>0)
    ? PARALLAX_TILE.img2x
    : PARALLAX_TILE.img1x;
  if (!tileImg || !tileImg.complete || tileImg.naturalWidth === 0) {
    const g = ctx.createLinearGradient(0,0,0,canvasH);
    g.addColorStop(0,'#001217'); g.addColorStop(0.5,'#0b1a2b'); g.addColorStop(1,'#071018');
    ctx.fillStyle = g; ctx.fillRect(0,0,canvasW,canvasH); return;
  }

  for (let i = 0; i < PARALLAX_SPEEDS.length; i++) {
    const speed = PARALLAX_SPEEDS[i];
    PARALLAX_OFFSETS[i] = (PARALLAX_OFFSETS[i] - PARALLAX_SCROLL_SPEED * speed * dt) % tileImg.height;
    if (PARALLAX_OFFSETS[i] < 0) PARALLAX_OFFSETS[i] += tileImg.height;
  }

  for (let layer = 0; layer < PARALLAX_SPEEDS.length; layer++) {
    const yOffset = PARALLAX_OFFSETS[layer];
    const baseY = canvasH - tileImg.height - (PARALLAX_SPEEDS.length - 1 - layer) * 8 * scaleFactor;
    let startY = baseY - yOffset;
    const tilesX = Math.ceil(canvasW / tileImg.width) + 1;

    for (let ty = startY; ty < canvasH; ty += tileImg.height) {
      for (let tx = 0; tx < tilesX; tx++) {
        ctx.drawImage(tileImg, tx * tileImg.width, ty, tileImg.width, tileImg.height);
      }
    }
    for (let ty = startY - tileImg.height; ty > -tileImg.height; ty -= tileImg.height) {
      for (let tx = 0; tx < tilesX; tx++) {
        ctx.drawImage(tileImg, tx * tileImg.width, ty, tileImg.width, tileImg.height);
      }
    }
  }
}

/* Draw objects */
function drawBackground(){
  ctx.lineWidth = Math.max(1, 1.2 * scaleFactor);
  for (let p of particles) {
    ctx.strokeStyle = `rgba(255,255,255,${p.alpha})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y + p.len);
    ctx.stroke();
    p.y += p.speed;
    if (p.y > window.innerHeight + p.len) { p.y = -p.len; p.x = Math.random() * window.innerWidth; }
  }
}

function drawStarship(){
  if (playerSkin && playerSkin.complete && playerSkin.naturalWidth > 0) {
    ctx.drawImage(playerSkin, starship.x - starship.w/2, starship.y - starship.h/2, starship.w, starship.h);
  } else {
    ctx.fillStyle = '#0ff';
    ctx.beginPath();
    ctx.ellipse(starship.x, starship.y, starship.w/2, starship.h/2, 0, 0, Math.PI*2);
    ctx.fill();
  }
}

/* Bullets */
function spawnBullet(x, y, vx, vy) {
  const now = performance.now();
  bullets.push({
    x, y, vx, vy,
    r: BULLET_RADIUS * scaleFactor,
    born: now,
    life: BULLET_LIFETIME
  });
}

function drawBullets(dt) {
  if (bullets.length === 0) return;
  ctx.save();
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * (dt / 1000);
    b.y += b.vy * (dt / 1000);
    if (performance.now() - b.born > b.life || b.x < -50 || b.x > window.innerWidth + 50 || b.y < -50 || b.y > window.innerHeight + 50) {
      bullets.splice(i, 1);
      continue;
    }
    const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 3);
    grad.addColorStop(0, 'rgba(0,255,208,0.95)');
    grad.addColorStop(0.2, 'rgba(0,255,208,0.6)');
    grad.addColorStop(1, 'rgba(0,255,208,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = BULLET_COLOR;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* Enemies: spawn with HP 3-5 hits */
function spawnEnemy(){
  const r = ENEMY_BASE_R * scaleFactor;
  const hp = Math.floor(Math.random() * 3) + 3; // 3..5
  enemies.push({
    x: Math.random() * (window.innerWidth - r*2) + r,
    y: -r - 10,
    r: r + Math.random() * (r * 0.6),
    angle: 0,
    hp: hp,
    maxHp: hp,
    hitFlash: 0
  });
}

/* Draw enemy with segmented HP ring around it (thinner border) */
function drawEnemy(en){
  // Surrounding soft shadow
  ctx.save();
  const shadowRadius = en.r * 1.25;
  const shadowAlpha = 0.18;
  const grd = ctx.createRadialGradient(en.x, en.y, en.r * 0.2, en.x, en.y, shadowRadius * 1.1);
  grd.addColorStop(0, `rgba(0,0,0,${shadowAlpha})`);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(en.x, en.y, shadowRadius * 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Enemy sprite / fallback
  ctx.save();
  ctx.translate(en.x, en.y);
  ctx.rotate(en.angle);
  if (enemySkin && enemySkin.complete && enemySkin.naturalWidth > 0) {
    ctx.drawImage(enemySkin, -en.r, -en.r, en.r*2, en.r*2);
  } else {
    ctx.fillStyle = '#f39c12';
    ctx.beginPath();
    ctx.arc(0,0,en.r,0,Math.PI*2);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1 * scaleFactor);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();
  }
  ctx.restore();

  // Segmented HP ring (тонкий бордер)
  const segments = Math.max(1, en.maxHp);
  const ringRadius = en.r * 1.45;
  const ringWidth = Math.max(3, en.r * 0.14); // уменьшенная толщина
  const gap = Math.PI * 0.04;
  const fullCircle = Math.PI * 2;
  for (let i = 0; i < segments; i++) {
    const start = (i / segments) * fullCircle + gap/2;
    const end = ((i + 1) / segments) * fullCircle - gap/2;
    // background (empty)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = ringWidth;
    ctx.lineCap = 'round';
    ctx.arc(en.x, en.y, ringRadius, start, end);
    ctx.stroke();
    // filled
    if (i < en.hp) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,255,106,0.95)';
      ctx.lineWidth = Math.max(1, ringWidth - 1);
      ctx.lineCap = 'round';
      ctx.arc(en.x, en.y, ringRadius, start, end);
      ctx.stroke();
    }
  }

  // Hit flash overlay
  if (en.hitFlash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(0,255,106,0.06)';
    ctx.beginPath();
    ctx.arc(en.x, en.y, en.r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (!gameRunning) return;
  en.angle += 0.02 + (Math.random() * 0.02);
  if (en.hitFlash > 0) en.hitFlash = Math.max(0, en.hitFlash - (lastFrameTimeDelta || 16));
}

/* Collision: bullets -> enemies */
function processBulletHits() {
  if (bullets.length === 0 || enemies.length === 0) return;
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    let hit = false;
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const en = enemies[ei];
      const dx = b.x - en.x;
      const dy = b.y - en.y;
      const dist2 = dx*dx + dy*dy;
      const rsum = b.r + en.r * 0.72;
      if (dist2 <= rsum * rsum) {
        en.hp -= 1;
        en.hitFlash = 160;
        spawnHitParticles(b.x, b.y);
        bullets.splice(bi, 1);
        hit = true;
        if (en.hp <= 0) {
          spawnExplosion(en.x, en.y, en.r);
          enemies.splice(ei, 1);
        }
        break;
      }
    }
    if (hit) continue;
  }
}

/* Particles */
function spawnHitParticles(x, y) {
  for (let i = 0; i < 6; i++) {
    particles.push({
      x: x + (Math.random()-0.5) * 8,
      y: y + (Math.random()-0.5) * 8,
      len: Math.random() * 8 + 6,
      speed: Math.random() * 2 + 1,
      alpha: 1,
      fade: true,
      life: 300 + Math.random() * 200,
      born: performance.now()
    });
  }
}

function spawnExplosion(x, y, r) {
  for (let i = 0; i < 18; i++) {
    particles.push({
      x: x,
      y: y,
      len: Math.random() * r * 0.6 + 6,
      speed: Math.random() * 3 + 1,
      alpha: 1,
      fade: true,
      life: 500 + Math.random() * 400,
      born: performance.now()
    });
  }
}

function updateAndDrawParticles(dt) {
  if (particles.length === 0) return;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (p.fade) {
      const age = performance.now() - (p.born || 0);
      const t = Math.min(1, age / (p.life || 400));
      p.alpha = Math.max(0, 1 - t);
      if (t >= 1) { particles.splice(i, 1); continue; }
    }
    p.y += p.speed * (dt / 16);
    ctx.strokeStyle = `rgba(255,255,255,${p.alpha})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y + p.len);
    ctx.stroke();
  }
}

/* Update logic */
let lastFrameTimeDelta = 16;
function update(dt){
  lastFrameTimeDelta = dt;
  let movementKeyPressed = false;

  if (starship) {
    const speed = 420 * scaleFactor * (dt/1000);
    if (keys['ArrowLeft'] || keys['a']) { starship.x -= speed; movementKeyPressed = true; }
    if (keys['ArrowRight'] || keys['d']) { starship.x += speed; movementKeyPressed = true; }
    if (keys['ArrowUp'] || keys['w']) { starship.y -= speed; movementKeyPressed = true; }
    if (keys['ArrowDown'] || keys['s']) { starship.y += speed; movementKeyPressed = true; }
    const halfW = starship.w/2, halfH = starship.h/2;
    starship.x = Math.max(halfW, Math.min(window.innerWidth - halfW, starship.x));
    starship.y = Math.max(halfH, Math.min(window.innerHeight - halfH, starship.y));
  }

  // Auto-shoot while controlling: pointerActive OR movement keys held
  if (gameRunning && (pointerActive || movementKeyPressed)) {
    tryShoot();
  }

  spawnTimer += dt;
  if (spawnTimer >= spawnInterval) {
    spawnTimer = 0;
    spawnEnemy();
    spawnInterval = Math.max(350, spawnInterval * 0.995);
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const en = enemies[i];
    en.y += (ENEMY_BASE_SPEED * scaleFactor) * (dt/1000);
    en.x += Math.sin((en.y + i) * 0.01) * 0.6 * scaleFactor;
    if (en.y > window.innerHeight + en.r + 20) enemies.splice(i,1);
  }

  processBulletHits();

  timeSurvived += dt;
  document.getElementById('hud').innerText = `Время: ${Math.floor(timeSurvived/1000)}s`;

  if (starship) {
    const playerRadius = Math.max(starship.w, starship.h) * 0.34;
    for (let en of enemies) {
      const dx = starship.x - en.x, dy = starship.y - en.y;
      const enemyRadius = en.r * 0.72;
      if (dx*dx + dy*dy < (playerRadius + enemyRadius) ** 2) {
        endGame();
        return;
      }
    }
  }
}

/* Main loop */
let lastFrameTime = performance.now();
function loop(now){
  if (!gameRunning) return;
  const dt = now - lastFrameTime;
  lastFrameTime = now;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  renderParallax(dt);
  drawBackground();
  for (let en of enemies) drawEnemy(en);
  drawStarship();
  drawBullets(dt);
  updateAndDrawParticles(dt);
  update(dt);
  rafId = requestAnimationFrame(loop);
}

/* Shooting logic */
function tryShoot() {
  const now = performance.now();
  if (now - lastShotAt < SHOOT_COOLDOWN) return;
  lastShotAt = now;
  const bx = starship.x;
  const by = starship.y - starship.h * 0.45;
  const vx = 0;
  const vy = -BULLET_SPEED;
  spawnBullet(bx, by, vx, vy);
  try {
    blasterSound.currentTime = 0;
    blasterSound.play().catch(()=>{});
  } catch(e) {}
}

/* Start / End handlers */
async function startPlay(){
  try {
    await setupParallaxSingleTile();
    await preloadImagesSilent(['player.png','enemy.png']);
    try { if (canvas.requestFullscreen) await canvas.requestFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch(e) { console.warn('fullscreen blocked', e); }
    document.getElementById('startScreen').style.display = 'none';
    hideGameOverModal();
    resizeCanvas(); initGame();
    for (let i=0;i<2;i++) spawnEnemy();
    lastFrameTime = performance.now();
    try { audioEl.currentTime = 0; await audioEl.play(); } catch(e) { console.warn('Audio play blocked', e); }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    alert('Ошибка при старте. Смотри консоль.');
  }
}

function endGame(){
  gameRunning = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  try { audioEl.pause(); audioEl.currentTime = 0; } catch(e) { console.warn('audio stop failed', e); }
  document.getElementById('hud').style.display = 'none';
  setTimeout(()=> {
    const seconds = Math.floor(timeSurvived/1000);
    document.getElementById('goScore').innerText = `${seconds} секунд`;
    showGameOverModal();
  }, 40);
}

/* Modal helpers */
function showGameOverModal(){
  const modal = document.getElementById('gameOverModal');
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden','false');
  const btn = document.getElementById('goRestart');
  try { btn.focus(); } catch(e) {}
}
function hideGameOverModal(){
  const modal = document.getElementById('gameOverModal');
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden','true');
}

/* Restart & menu */
async function restartFromModal(){
  hideGameOverModal();
  await setupParallaxSingleTile();
  initGame();
  for (let i=0;i<2;i++) spawnEnemy();
  lastFrameTime = performance.now();
  try { audioEl.currentTime = 0; await audioEl.play(); } catch(e) { console.warn('audio play failed', e); }
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}
function backToMenu(){
  hideGameOverModal();
  document.getElementById('startScreen').style.display = 'flex';
}

/* Input & controls */
let pointerActive = false, lastPointerX = 0, lastPointerY = 0;
canvas.addEventListener('pointerdown', e => {
  pointerActive = true; lastPointerX = e.clientX; lastPointerY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch{}
  if (gameRunning) tryShoot();
});
canvas.addEventListener('pointermove', e => {
  if (!pointerActive || !starship) return;
  const dx = e.clientX - lastPointerX, dy = e.clientY - lastPointerY;
  starship.x += dx; starship.y += dy;
  lastPointerX = e.clientX; lastPointerY = e.clientY;
});
canvas.addEventListener('pointerup', e => { pointerActive = false; try { canvas.releasePointerCapture(e.pointerId); } catch{} });

document.addEventListener('touchstart', e => {
  if (!gameRunning) return;
  const t = e.touches[0];
  if (t) { pointerActive = true; lastPointerX = t.clientX; lastPointerY = t.clientY; }
  if (gameRunning) tryShoot();
}, { passive:true });

document.addEventListener('touchmove', e => {
  if (!pointerActive || !starship) return;
  const t = e.touches[0];
  if (t) {
    const dx = t.clientX - lastPointerX, dy = t.clientY - lastPointerY;
    starship.x += dx; starship.y += dy;
    lastPointerX = t.clientX; lastPointerY = t.clientY;
  }
}, { passive:true });

document.addEventListener('touchend', ()=> pointerActive = false);

const keys = {};
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (e.code === 'Space' || e.key === ' ') {
    if (gameRunning) tryShoot();
    e.preventDefault();
  }
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

/* UI bindings */
document.getElementById('startBtn').addEventListener('click', startPlay);
document.getElementById('goRestart').addEventListener('click', restartFromModal);
document.getElementById('goMenu').addEventListener('click', backToMenu);

/* Initial preload */
(function initialPreload(){
  preloadImagesSilent(['player.png','enemy.png','bg_tile.png']).then(()=> {
    document.getElementById('startScreen').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
  });
})();