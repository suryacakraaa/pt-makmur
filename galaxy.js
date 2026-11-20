/* galaxy.js — Radiant Spiral Galaxy with Inward Cosmic Swirl (Golden Galactic Core) */
(function () {
  'use strict';

  const canvas = document.getElementById('galaxy-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, dpr;
  let animId = null;
  let lastTime = 0;

  // ── Pre-rendered glowing particle & nebular gas sprites ──
  const SPRITES = {};

  function makeRadialSprite(r, g, b, radius, innerAlpha = 1, outerAlpha = 0) {
    const sCanvas = document.createElement('canvas');
    const size = Math.ceil(radius * 4);
    sCanvas.width = size;
    sCanvas.height = size;
    const sCtx = sCanvas.getContext('2d');
    const half = size / 2;

    const grad = sCtx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0,    `rgba(${r}, ${g}, ${b}, ${innerAlpha})`);
    grad.addColorStop(0.22, `rgba(${r}, ${g}, ${b}, ${(innerAlpha * 0.75).toFixed(3)})`);
    grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${(innerAlpha * 0.25).toFixed(3)})`);
    grad.addColorStop(1,    `rgba(${r}, ${g}, ${b}, ${outerAlpha})`);

    sCtx.fillStyle = grad;
    sCtx.beginPath();
    sCtx.arc(half, half, half, 0, Math.PI * 2);
    sCtx.fill();
    return sCanvas;
  }

  function initSprites() {
    // Sharp luminous star particles
    SPRITES.starWhite  = makeRadialSprite(255, 255, 255, 12, 1.0);
    SPRITES.starGold   = makeRadialSprite(254, 225, 115, 13, 0.95);
    SPRITES.starAmber  = makeRadialSprite(245, 158, 11,  14, 0.9);
    SPRITES.starCyan   = makeRadialSprite(56,  189, 248, 13, 0.95);
    SPRITES.starBlue   = makeRadialSprite(96,  165, 250, 14, 0.9);
    SPRITES.starViolet = makeRadialSprite(192, 132, 252, 14, 0.85);

    // Soft volumetric nebular clouds (forms the rich, lush, continuous glowing galaxy disk)
    SPRITES.gasWhite  = makeRadialSprite(255, 255, 230, 36, 0.22);
    SPRITES.gasGold   = makeRadialSprite(250, 204, 21,  42, 0.18);
    SPRITES.gasAmber  = makeRadialSprite(217, 119, 6,   44, 0.16);
    SPRITES.gasCyan   = makeRadialSprite(56,  189, 248, 48, 0.16);
    SPRITES.gasBlue   = makeRadialSprite(37,  99,  235, 52, 0.14);
    SPRITES.gasIndigo = makeRadialSprite(79,  70,  229, 48, 0.12);
  }

  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // ── Accretion & Galaxy Parameters ──
  const ARMS = 2;
  const WINDING = 3.4;
  const CORE_DISSOLVE_R = 0.045; // Radius where inward particles dissolve into the bright core
  const SPAWN_MAX_R = 1.15;

  // ── Population: 6,000 Stars + 450 Nebular Gas Clouds ──
  const TOTAL_STARS  = 6000;
  const TOTAL_CLOUDS = 450;

  const stars = [];
  const clouds = [];

  function spawnEntity(isCloud, initialDistribute = false) {
    const isSpur = Math.random() < 0.24;
    const arm = Math.floor(Math.random() * ARMS);
    const baseAngle = arm * Math.PI + (isSpur ? 0.6 : 0);

    let r;
    if (initialDistribute) {
      r = 0.05 + Math.pow(Math.random(), 0.82) * (SPAWN_MAX_R - 0.05);
    } else {
      r = 1.02 + Math.random() * 0.15; // Respawn at the outer cosmic edge
    }

    const spiralAngle = baseAngle + Math.pow(r, 0.76) * WINDING;
    // Arm thickness grows wider at outer radius
    const armSpread = randn() * (0.14 + r * 0.18);
    const theta = spiralAngle + armSpread;

    if (isCloud) {
      return {
        r,
        theta,
        baseSize: (30 + r * 46) * (Math.random() * 0.35 + 0.85),
        maxAlpha: (Math.random() * 0.25 + 0.35) * (1.1 - r * 0.3),
        currentAlpha: initialDistribute ? 0.35 : 0.0,
        radialSpeedMult: Math.random() * 0.35 + 0.85
      };
    } else {
      return {
        r,
        theta,
        size: Math.random() * 1.8 + 0.75,
        maxAlpha: Math.random() * 0.4 + 0.45,
        currentAlpha: initialDistribute ? 0.45 : 0.0,
        twinkleSpeed: Math.random() * 0.05 + 0.02,
        twinklePhase: Math.random() * Math.PI * 2,
        radialSpeedMult: Math.random() * 0.4 + 0.8
      };
    }
  }

  function initPopulation() {
    stars.length = 0;
    clouds.length = 0;

    for (let i = 0; i < TOTAL_CLOUDS; i++) {
      clouds.push(spawnEntity(true, true));
    }
    for (let i = 0; i < TOTAL_STARS; i++) {
      stars.push(spawnEntity(false, true));
    }
  }

  // ── Background deep-space static stars ──
  const BG_STARS = Array.from({ length: 220 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.3 + 0.3,
    a: Math.random() * 0.45 + 0.15,
    speed: Math.random() * 0.025 + 0.01,
    phase: Math.random() * Math.PI * 2
  }));

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.offsetWidth  || window.innerWidth;
    H = canvas.offsetHeight || window.innerHeight;
    canvas.width  = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }

  // ── Main Render & Inward Swirl Physics Loop ──
  function draw(now) {
    if (!lastTime) lastTime = now;
    const dt = Math.min((now - lastTime) * 0.001, 0.05);
    lastTime = now;
    const t = now * 0.001;

    ctx.clearRect(0, 0, W, H);

    // 1. Distant space static stars
    for (let i = 0; i < BG_STARS.length; i++) {
      const s = BG_STARS[i];
      const twk = Math.sin(t * s.speed * 40 + s.phase) * 0.35 + 0.65;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${(s.a * twk).toFixed(3)})`;
      ctx.fill();
    }

    // 2. 3D Galaxy Perspective Geometry
    const cx = W * 0.56;
    const cy = H * 0.42;
    const galaxyRadius = Math.min(W * 0.54, H * 0.80, 580);

    const pitch = 1.08; // ~62 degrees tilt
    const cosPitch = Math.cos(pitch);
    const yaw = -0.18;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    // 3. Glowing Radiant Golden Galactic Nucleus (Smooth, Warm, Natural)
    const pulse = Math.sin(t * 1.8) * 0.05 + 0.95;
    const coreOuterW = galaxyRadius * 0.42 * pulse;
    const coreMidW   = galaxyRadius * 0.24 * pulse;
    const coreInnerW = galaxyRadius * 0.11 * pulse;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1.0, cosPitch);

    // Outer warm atmospheric glow
    const outerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, coreOuterW);
    outerGlow.addColorStop(0,    `rgba(254, 240, 138, ${(0.35 * pulse).toFixed(3)})`);
    outerGlow.addColorStop(0.35, `rgba(245, 158, 11,  ${(0.20 * pulse).toFixed(3)})`);
    outerGlow.addColorStop(0.70, `rgba(56,  189, 248, ${(0.08 * pulse).toFixed(3)})`);
    outerGlow.addColorStop(1,    'rgba(14,  165, 233, 0)');
    ctx.beginPath();
    ctx.arc(0, 0, coreOuterW, 0, Math.PI * 2);
    ctx.fillStyle = outerGlow;
    ctx.fill();

    // Mid dense golden core bulge
    const midGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, coreMidW);
    midGlow.addColorStop(0,    `rgba(255, 255, 240, ${(0.65 * pulse).toFixed(3)})`);
    midGlow.addColorStop(0.45, `rgba(254, 225, 115, ${(0.45 * pulse).toFixed(3)})`);
    midGlow.addColorStop(1,    'rgba(245, 158, 11,  0)');
    ctx.beginPath();
    ctx.arc(0, 0, coreMidW, 0, Math.PI * 2);
    ctx.fillStyle = midGlow;
    ctx.fill();

    // Central radiant galactic heart (Pure white/gold brilliant core)
    const innerHeart = ctx.createRadialGradient(0, 0, 0, 0, 0, coreInnerW);
    innerHeart.addColorStop(0,   `rgba(255, 255, 255, ${(0.92 * pulse).toFixed(3)})`);
    innerHeart.addColorStop(0.6, `rgba(255, 250, 205, ${(0.65 * pulse).toFixed(3)})`);
    innerHeart.addColorStop(1,   'rgba(254, 240, 138, 0)');
    ctx.beginPath();
    ctx.arc(0, 0, coreInnerW, 0, Math.PI * 2);
    ctx.fillStyle = innerHeart;
    ctx.fill();

    ctx.restore();

    // 4. Volumetric Nebular Gas Clouds Layer (Swirling Inward)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < TOTAL_CLOUDS; i++) {
      const c = clouds[i];

      // Inward vortex suction
      const inwardSpeed = (0.022 / (Math.pow(c.r, 0.65) + 0.12)) * c.radialSpeedMult * dt;
      c.r -= inwardSpeed;

      // Angular swirl acceleration towards galactic core
      const swirlSpeed = (0.22 + 0.075 / (Math.pow(c.r, 1.25) + 0.08)) * dt;
      c.theta += swirlSpeed;

      // Smooth fade-in at outer rim
      if (c.currentAlpha < c.maxAlpha) {
        c.currentAlpha = Math.min(c.maxAlpha, c.currentAlpha + dt * 0.8);
      }

      // Dissolve into bright galactic core & respawn at outer edge
      if (c.r <= CORE_DISSOLVE_R) {
        Object.assign(c, spawnEntity(true, false));
        continue;
      }

      // Color progression matching the reference image
      let spriteKey;
      if (c.r < 0.18) {
        spriteKey = 'gasWhite';
      } else if (c.r < 0.35) {
        spriteKey = 'gasGold';
      } else if (c.r < 0.52) {
        spriteKey = 'gasAmber';
      } else if (c.r < 0.78) {
        spriteKey = 'gasCyan';
      } else if (c.r < 0.98) {
        spriteKey = 'gasBlue';
      } else {
        spriteKey = 'gasIndigo';
      }

      const x = c.r * Math.cos(c.theta);
      const y = c.r * Math.sin(c.theta);

      const screenX = cx + (x * cosYaw - y * sinYaw) * galaxyRadius;
      const screenY = cy + (x * sinYaw + y * cosYaw) * cosPitch * galaxyRadius;

      const size = c.baseSize * Math.min(1.0, Math.max(0.4, c.r * 1.5));
      const sprite = SPRITES[spriteKey] || SPRITES.gasCyan;

      ctx.globalAlpha = c.currentAlpha * 0.50;
      ctx.drawImage(
        sprite,
        screenX - size,
        screenY - size * cosPitch,
        size * 2,
        size * 2 * cosPitch
      );
    }

    // 5. Star Dust Particles Layer (Spiraling Inward into Core)
    for (let i = 0; i < TOTAL_STARS; i++) {
      const s = stars[i];

      // Inward suction
      const inwardSpeed = (0.025 / (Math.pow(s.r, 0.65) + 0.12)) * s.radialSpeedMult * dt;
      s.r -= inwardSpeed;

      // Orbital acceleration
      const swirlSpeed = (0.24 + 0.085 / (Math.pow(s.r, 1.25) + 0.07)) * dt;
      s.theta += swirlSpeed;

      // Smooth outer fade-in
      if (s.currentAlpha < s.maxAlpha) {
        s.currentAlpha = Math.min(s.maxAlpha, s.currentAlpha + dt * 0.8);
      }

      // Dissolve into the glowing nucleus & respawn
      if (s.r <= CORE_DISSOLVE_R) {
        Object.assign(s, spawnEntity(false, false));
        continue;
      }

      // Star color heating up towards the golden center
      let spriteKey;
      if (s.r < 0.14) {
        spriteKey = 'starWhite';
      } else if (s.r < 0.32) {
        spriteKey = 'starGold';
      } else if (s.r < 0.52) {
        spriteKey = 'starAmber';
      } else if (s.r < 0.76) {
        spriteKey = 'starCyan';
      } else if (s.r < 0.98) {
        spriteKey = 'starBlue';
      } else {
        spriteKey = 'starViolet';
      }

      const x = s.r * Math.cos(s.theta);
      const y = s.r * Math.sin(s.theta);

      const screenX = cx + (x * cosYaw - y * sinYaw) * galaxyRadius;
      const screenY = cy + (x * sinYaw + y * cosYaw) * cosPitch * galaxyRadius;

      if (screenX < -25 || screenX > W + 25 || screenY < -25 || screenY > H + 25) {
        continue;
      }

      const twk = Math.sin(t * s.twinkleSpeed * 40 + s.twinklePhase) * 0.25 + 0.75;
      const alpha = Math.max(0.12, Math.min(1.0, s.currentAlpha * twk));
      const renderSize = s.size;

      const sprite = SPRITES[spriteKey] || SPRITES.starBlue;
      ctx.globalAlpha = alpha * 0.58;
      ctx.drawImage(
        sprite,
        screenX - renderSize * 2,
        screenY - renderSize * 2,
        renderSize * 4,
        renderSize * 4
      );
    }

    ctx.restore();

    animId = requestAnimationFrame(draw);
  }

  function start() {
    if (animId) cancelAnimationFrame(animId);
    lastTime = 0;
    resize();
    animId = requestAnimationFrame(draw);
  }

  function stop() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  // Setup & Events
  initSprites();
  initPopulation();

  window.addEventListener('resize', resize);

  const dashPage = document.getElementById('page-dashboard');
  if (dashPage) {
    const obs = new MutationObserver(() => {
      dashPage.classList.contains('active') ? start() : stop();
    });
    obs.observe(dashPage, { attributes: true, attributeFilter: ['class'] });
    if (dashPage.classList.contains('active')) start();
  } else {
    start();
  }
})();
