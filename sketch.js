const GLYPHS = "abcdefghijklmnopqrstuvwxyz0123456789+×÷=<>~{}[]!?;:";
const GLYPH_SIZES = [6, 8, 10, 12];
const GLYPH_CELL = 24;
const GLYPH_ATLAS_DENSITY = 2;
const STRAND_COUNT = 60;
const STRAND_NODES = 9;
const RIPPLE_POOL_SIZE = 10;

// Main tuning surface. These values can also be changed through window.DREAM_PARAMS.
const DREAM_PARAMS = {
  glyphsPerStrandDesktop: 50,
  glyphsPerStrandMobile: 38,
  glyphsPerStrandReduced: 28,
  doubleTapMs: 360,
  tapMaxDurationMs: 280,
  tapMoveTolerance: 18,
  doubleTapDistance: 40,
  birdGatherMs: 1900,
  birdHoldMs: 900,
  birdFlightMs: 4600,
  birdScale: 1.15,
  birdFlightX: 0.92,
  birdFlightY: 0.78,
  birdWobble: 8,
  birdWingCycleMs: 1500,
  birdWingOpenMin: 0.42,
  questionParticleCount: 200,
  questionParticleSpeed: 0.13,
  questionPulseSpeed: 0.035,
};

let strands = [];
let particles = [];
let ripples = [];
let trailLayer;
let fogLayer;
let glyphAtlas;
let glyphsPerStrand = 0;
let dreamAlpha = 0;
let reducedMotion = false;
let lastFrameTime = 0;

const pointer = {
  x: 0,
  y: 0,
  px: 0,
  py: 0,
  vx: 0,
  vy: 0,
  speed: 0,
  active: false,
  down: false,
  lastMove: -10000,
};

const tapGesture = {
  pointerId: null,
  pointerType: "mouse",
  startedAt: 0,
  startX: 0,
  startY: 0,
  moved: false,
  lastTapAt: -Infinity,
  lastTapX: 0,
  lastTapY: 0,
};

const butterfly = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  angle: 0,
  phase: 0,
  wingPhase: 0,
  speed: 0,
};

const birdEvent = {
  phase: "idle",
  startedAt: 0,
  x: 0,
  y: 0,
};

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("artwork");
  window.DREAM_PARAMS = DREAM_PARAMS;
  pixelDensity(getRenderDensity());
  frameRate(60);
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  canvas.elt.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.elt.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary) {
      tapGesture.moved = true;
      tapGesture.lastTapAt = -Infinity;
      return;
    }
    if (event.button !== 0 || pointer.down) return;
    startPointerTap(event);
  });
  canvas.elt.addEventListener("pointermove", (event) => {
    registerPointer(event.clientX, event.clientY);
  });
  window.addEventListener("pointermove", (event) => {
    if (event.pointerId === tapGesture.pointerId) {
      trackTapMovement(event.clientX, event.clientY);
    }
  });
  window.addEventListener("pointerup", endPointerTap);
  window.addEventListener("pointercancel", cancelPointerTap);
  window.addEventListener("blur", cancelPointerTap);
  canvas.elt.addEventListener("dblclick", (event) => event.preventDefault());

  buildGlyphAtlas();
  createLayers();
  buildScene();
  pointer.x = pointer.px = width * 0.5;
  pointer.y = pointer.py = height * 0.5;
  butterfly.x = width * 0.5;
  butterfly.y = height * 0.5;
  butterfly.phase = random(TWO_PI);
  lastFrameTime = millis();
}

function getRenderDensity() {
  const deviceDensity = window.devicePixelRatio || 1;
  const isCompact = Math.min(window.innerWidth, window.innerHeight) < 700;
  const isCoarse = window.matchMedia("(pointer: coarse)").matches;
  return Math.min(deviceDensity, isCompact || isCoarse ? 1.25 : 1.5);
}

function buildGlyphAtlas() {
  glyphAtlas = document.createElement("canvas");
  glyphAtlas.width = GLYPHS.length * GLYPH_CELL * GLYPH_ATLAS_DENSITY;
  glyphAtlas.height = GLYPH_SIZES.length * GLYPH_CELL * GLYPH_ATLAS_DENSITY;

  const ctx = glyphAtlas.getContext("2d");
  ctx.scale(GLYPH_ATLAS_DENSITY, GLYPH_ATLAS_DENSITY);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.imageSmoothingEnabled = true;

  for (let sizeIndex = 0; sizeIndex < GLYPH_SIZES.length; sizeIndex += 1) {
    ctx.font = `${GLYPH_SIZES[sizeIndex]}px Arial`;
    for (let glyphIndex = 0; glyphIndex < GLYPHS.length; glyphIndex += 1) {
      ctx.fillText(
        GLYPHS[glyphIndex],
        glyphIndex * GLYPH_CELL + GLYPH_CELL * 0.5,
        sizeIndex * GLYPH_CELL + GLYPH_CELL * 0.5,
      );
    }
  }
}

function createLayers() {
  if (trailLayer) {
    trailLayer.remove();
  }
  if (fogLayer) {
    fogLayer.remove();
  }

  trailLayer = createGraphics(width, height);
  trailLayer.pixelDensity(1);
  trailLayer.clear();

  fogLayer = createGraphics(width, height);
  fogLayer.pixelDensity(1);
  renderFog();
}

function buildScene() {
  strands.length = 0;
  particles.length = 0;
  ripples.length = 0;

  const spacing = width / (STRAND_COUNT + 1);
  for (let i = 0; i < STRAND_COUNT; i += 1) {
    const jitter = random(-spacing * 0.32, spacing * 0.32);
    strands.push(new Strand(spacing * (i + 1) + jitter, i));
  }

  const isCompact = Math.min(width, height) < 700;
  const isCoarse = window.matchMedia("(pointer: coarse)").matches;
  glyphsPerStrand = reducedMotion
    ? DREAM_PARAMS.glyphsPerStrandReduced
    : isCompact || isCoarse
      ? DREAM_PARAMS.glyphsPerStrandMobile
      : DREAM_PARAMS.glyphsPerStrandDesktop;
  const particleCount = STRAND_COUNT * glyphsPerStrand;

  for (let i = 0; i < particleCount; i += 1) {
    particles.push(new GlyphParticle(i));
  }

  for (let i = 0; i < RIPPLE_POOL_SIZE; i += 1) {
    ripples.push(new Ripple());
  }
}

function draw() {
  const now = millis();
  const dt = constrain((now - lastFrameTime) / 16.6667, 0.35, 1.8);
  lastFrameTime = now;

  drawBackground();
  fadeTrailLayer();

  const idleMs = now - pointer.lastMove;
  pointer.active = idleMs < 230;
  pointer.vx *= pow(0.72, dt);
  pointer.vy *= pow(0.72, dt);
  pointer.speed *= pow(0.76, dt);

  updateButterfly(dt, now);
  updateBirdEvent(now);
  updateRipples(dt);
  updateStrands(dt);
  updateParticles(dt, now);
  renderTrails(now);

  image(trailLayer, 0, 0, width, height);
  image(fogLayer, 0, 0, width, height);
  renderQuestion();
  if (birdEvent.phase === "idle") {
    renderButterfly(now);
  } else {
    renderCrystalButterfly(now);
  }
  renderDream(idleMs, dt);
}

function renderQuestion() {
  const size = constrain(min(width, height) * 0.034, 17, 29);
  const pulse = 0.94 + sin(frameCount * DREAM_PARAMS.questionPulseSpeed) * 0.06;
  const alpha = 190 + sin(frameCount * DREAM_PARAMS.questionPulseSpeed) * 18;
  const centerX = width * 0.5;
  const centerY = height * 0.17;

  push();
  textAlign(CENTER, CENTER);
  textFont("Microsoft YaHei");
  textStyle(NORMAL);
  textSize(size);

  drawingContext.save();
  drawingContext.globalCompositeOperation = "screen";
  drawingContext.shadowColor = "rgba(205,245,255,0.9)";
  drawingContext.shadowBlur = 10;
  noStroke();
  for (let i = 0; i < DREAM_PARAMS.questionParticleCount; i += 1) {
    const seed = i * 1.917;
    const cycle = (frameCount * 0.001 * DREAM_PARAMS.questionParticleSpeed + i * 0.071) % 1;
    const spread = 0.2 + cycle * cycle * 1.3;
    const angle = seed + sin(seed * 2.7) * 0.9;
    const driftX = sin(frameCount * 0.009 + seed * 3.1) * size * 0.7;
    const driftY = cos(frameCount * 0.007 + seed * 2.2) * size * 0.45;
    const x = centerX + cos(angle) * size * spread * 4.8 + driftX;
    const y = centerY + sin(angle) * size * spread * 2.2 + driftY;
    const particleAlpha = (1 - cycle) * 150 + 20;
    const particleSize = 1.1 + (1 - cycle) * 2.2;
    fill(210, 250, 255, particleAlpha);
    circle(x, y, particleSize);
  }
  drawingContext.restore();

  drawingContext.save();
  drawingContext.globalCompositeOperation = "screen";
  drawingContext.shadowColor = `rgba(150,240,255,${0.58 * pulse})`;
  drawingContext.shadowBlur = 28 + pulse * 12;
  fill(150, 235, 255, 70 * pulse);
  textSize(size * pulse);
  text("天空是什么颜色的？", centerX, centerY);
  drawingContext.shadowColor = `rgba(255,255,255,${0.88 * pulse})`;
  drawingContext.shadowBlur = 10 + pulse * 7;
  fill(220, 250, 255, 150 * pulse);
  text("天空是什么颜色的？", centerX, centerY);
  drawingContext.restore();

  drawingContext.shadowColor = `rgba(255,255,255,${0.72 * pulse})`;
  drawingContext.shadowBlur = 5 + pulse * 4;
  fill(255, 255, 255, alpha);
  text("天空是什么颜色的？", centerX, centerY);
  pop();
}

function drawBackground() {
  const ctx = drawingContext;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#113bf1");
  gradient.addColorStop(0.48, "#245cff");
  gradient.addColorStop(0.77, "#7c8dff");
  gradient.addColorStop(1, "#f6eaff");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  noStroke();
  fill(36, 84, 255, 20);
  ellipse(width * 0.5, height * 0.28, width * 1.4, height * 0.82);
}

function renderFog() {
  fogLayer.clear();
  const ctx = fogLayer.drawingContext;
  const gradient = ctx.createLinearGradient(0, height * 0.58, 0, height);
  gradient.addColorStop(0, "rgba(255,244,255,0)");
  gradient.addColorStop(0.45, "rgba(248,235,255,0.08)");
  gradient.addColorStop(0.72, "rgba(255,245,255,0.38)");
  gradient.addColorStop(1, "rgba(255,251,255,0.92)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, height * 0.55, width, height * 0.45);

  fogLayer.noStroke();
  for (let i = 0; i < 12; i += 1) {
    const y = height * (0.72 + i * 0.024);
    fogLayer.fill(255, 246, 255, 8 + i * 4);
    fogLayer.ellipse(width * 0.5, y, width * (1.2 + i * 0.05), height * 0.13);
  }
}

function fadeTrailLayer() {
  const ctx = trailLayer.drawingContext;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = reducedMotion ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.075)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function updateStrands(dt) {
  for (let i = 0; i < strands.length; i += 1) {
    strands[i].update(dt);
  }
}

function updateParticles(dt, now) {
  for (let i = 0; i < particles.length; i += 1) {
    particles[i].update(dt, now);
  }
}

function renderTrails(now) {
  const g = trailLayer;
  const ctx = g.drawingContext;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.lineWidth = max(0.55, width / 1100);
  ctx.lineCap = "round";
  for (let i = 0; i < strands.length; i += 1) {
    strands[i].render(g);
  }

  for (let i = 0; i < particles.length; i += 1) {
    particles[i].render(g, now);
  }

  for (let i = 0; i < ripples.length; i += 1) {
    ripples[i].render(g);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function startBirdEvent(now) {
  birdEvent.phase = "gather";
  birdEvent.startedAt = now;
  birdEvent.x = width * 0.5;
  birdEvent.y = height * 0.47;

  for (let i = 0; i < particles.length; i += 1) {
    particles[i].captureBird(birdEvent.x, birdEvent.y);
  }
}

function updateBirdEvent(now) {
  if (birdEvent.phase === "idle") return;

  const elapsed = now - birdEvent.startedAt;
  if (
    birdEvent.phase === "gather" &&
    elapsed >= DREAM_PARAMS.birdGatherMs
  ) {
    birdEvent.phase = "hold";
    birdEvent.startedAt = now;
    return;
  }

  if (birdEvent.phase === "hold" && elapsed >= DREAM_PARAMS.birdHoldMs) {
    birdEvent.phase = "flight";
    birdEvent.startedAt = now;
    return;
  }

  if (birdEvent.phase === "flight" && elapsed >= DREAM_PARAMS.birdFlightMs) {
    birdEvent.phase = "idle";
    birdEvent.startedAt = 0;
    trailLayer.clear();
    for (let i = 0; i < particles.length; i += 1) {
      particles[i].reset(null, false);
    }
  }
}

function birdPoseAt(now) {
  if (birdEvent.phase !== "flight") {
    const holdWobble = sin(now * 0.006) * 3;
    return {
      x: birdEvent.x + holdWobble,
      y: birdEvent.y + cos(now * 0.005) * 2,
      flightProgress: 0,
    };
  }

  const progress = constrain(
    (now - birdEvent.startedAt) / DREAM_PARAMS.birdFlightMs,
    0,
    1,
  );
  const eased = progress * progress * (3 - 2 * progress);
  return {
    x: birdEvent.x + eased * width * DREAM_PARAMS.birdFlightX,
    y:
      birdEvent.y -
      eased * height * DREAM_PARAMS.birdFlightY +
      sin(progress * PI * 2) * DREAM_PARAMS.birdWobble,
    flightProgress: progress,
  };
}

function birdWingOpenAt(now) {
  const cycle = DREAM_PARAMS.birdWingCycleMs;
  const phase = ((now % cycle) / cycle) * TWO_PI;
  const wave = (sin(phase) + 1) * 0.5;
  return lerp(DREAM_PARAMS.birdWingOpenMin, 1, wave);
}

function birdTargetFor(index, wingOpen = 1) {
  const seed = fract(Math.sin(index * 12.9898) * 43758.5453);
  const seed2 = fract(Math.sin((index + 17) * 78.233) * 19341.173);
  const size = min(width, height) * 0.15 * DREAM_PARAMS.birdScale;
  const group = index % 100;

  if (group < 8) {
    return {
      x: (seed - 0.5) * size * 0.12,
      y: (seed2 - 0.5) * size * 0.92,
    };
  }

  if (group < 12) {
    const side = index % 2 === 0 ? -1 : 1;
    return {
      x: side * size * (0.03 + seed * 0.28),
      y: -size * (0.42 + seed2 * 0.35),
    };
  }

  const side = index % 2 === 0 ? -1 : 1;
  const angle = seed * TWO_PI;
  const radius = sqrt(seed2);

  if (group < 72) {
    const localX = abs(cos(angle)) * size * 0.82 * radius;
    const localY = sin(angle) * size * 0.52 * radius;
    return {
      x: side * (size * 0.08 + localX) * wingOpen,
      y: -size * 0.2 + localY * (0.76 + wingOpen * 0.24),
    };
  }

  const localX = abs(cos(angle)) * size * 0.58 * radius;
  const localY = sin(angle) * size * 0.4 * radius;
  return {
    x: side * (size * 0.08 + localX) * wingOpen,
    y: size * 0.25 + localY * (0.7 + wingOpen * 0.3),
  };
}

function updateButterfly(dt, now) {
  const scale = min(width / 390, 1.35);
  const flutterX = sin(now * 0.0022 + butterfly.phase) * 18 * scale;
  const flutterY =
    sin(now * 0.0034 + butterfly.phase * 1.7) * 13 * scale +
    cos(now * 0.0014 + butterfly.phase) * 7 * scale;
  const targetX = pointer.x + flutterX;
  const targetY = pointer.y + flutterY;

  butterfly.vx += (targetX - butterfly.x) * 0.018 * dt;
  butterfly.vy += (targetY - butterfly.y) * 0.018 * dt;
  butterfly.vx += sin(now * 0.005 + butterfly.phase) * 0.12 * scale * dt;
  butterfly.vy += cos(now * 0.004 + butterfly.phase * 1.4) * 0.1 * scale * dt;
  butterfly.vx *= pow(0.9, dt);
  butterfly.vy *= pow(0.9, dt);
  butterfly.x += butterfly.vx * dt;
  butterfly.y += butterfly.vy * dt;
  butterfly.x = constrain(butterfly.x, -30, width + 30);
  butterfly.y = constrain(butterfly.y, -30, height + 30);
  butterfly.speed = lerp(
    butterfly.speed,
    sqrt(butterfly.vx * butterfly.vx + butterfly.vy * butterfly.vy),
    0.18,
  );
  butterfly.angle = lerp(
    butterfly.angle,
    constrain(atan2(butterfly.vy, butterfly.vx) * 0.35, -0.5, 0.5),
    0.12 * dt,
  );
  butterfly.wingPhase += (0.34 + butterfly.speed * 0.035) * dt;

  if (butterfly.speed > 3.5 && frameCount % 4 === 0) {
    emitRipple(butterfly.x, butterfly.y, butterfly.speed * 2.2);
  }
}

function renderButterfly(now) {
  const ctx = drawingContext;
  const flap = 0.72 + abs(sin(butterfly.wingPhase)) * 0.38;
  const size = constrain(min(width, height) * 0.035, 15, 28);
  const glow = 0.45 + min(butterfly.speed / 8, 0.35);

  ctx.save();
  ctx.translate(butterfly.x, butterfly.y);
  ctx.rotate(butterfly.angle);
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = `rgba(219, 244, 255, ${glow})`;
  ctx.shadowBlur = 13;
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = `rgba(237, 249, 255, ${0.48 + glow * 0.18})`;

  drawButterflyWing(ctx, -1, size, flap);
  drawButterflyWing(ctx, 1, size, flap);

  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.52);
  ctx.quadraticCurveTo(size * 0.08, 0, 0, size * 0.58);
  ctx.quadraticCurveTo(-size * 0.08, 0, 0, -size * 0.52);
  ctx.fillStyle = "rgba(242, 250, 255, 0.58)";
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-size * 0.04, -size * 0.45);
  ctx.quadraticCurveTo(-size * 0.3, -size * 0.82, -size * 0.5, -size * 0.92);
  ctx.moveTo(size * 0.04, -size * 0.45);
  ctx.quadraticCurveTo(size * 0.3, -size * 0.82, size * 0.5, -size * 0.92);
  ctx.strokeStyle = "rgba(240, 250, 255, 0.44)";
  ctx.stroke();
  ctx.restore();
}

function renderCrystalButterfly(now) {
  const pose = birdPoseAt(now);
  const wingOpen = birdWingOpenAt(now);
  const size = min(width, height) * 0.15 * DREAM_PARAMS.birdScale;
  const flightFade =
    birdEvent.phase === "flight"
      ? 1 - pose.flightProgress * 0.55
      : 1;
  const alpha = 0.52 * flightFade;
  const tilt =
    birdEvent.phase === "flight"
      ? -0.24 + pose.flightProgress * 0.08
      : sin(now * 0.002) * 0.035;
  const ctx = drawingContext;

  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(tilt);
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowColor = `rgba(223, 249, 255, ${alpha})`;
  ctx.shadowBlur = 20;
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(245, 253, 255, ${alpha * 0.9})`;

  drawCrystalWing(ctx, -1, size, wingOpen, alpha);
  drawCrystalWing(ctx, 1, size, wingOpen, alpha);

  ctx.shadowBlur = 11;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.34);
  ctx.lineTo(size * 0.06, size * 0.4);
  ctx.lineTo(0, size * 0.55);
  ctx.lineTo(-size * 0.06, size * 0.4);
  ctx.closePath();
  ctx.fillStyle = `rgba(235, 251, 255, ${alpha * 0.55})`;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -size * 0.33);
  ctx.lineTo(-size * 0.28, -size * 0.73);
  ctx.moveTo(0, -size * 0.33);
  ctx.lineTo(size * 0.28, -size * 0.73);
  ctx.strokeStyle = `rgba(249, 254, 255, ${alpha * 0.7})`;
  ctx.stroke();
  ctx.restore();
}

function drawCrystalWing(ctx, side, size, wingOpen, alpha) {
  const spread = size * (0.66 + wingOpen * 0.35);
  const lift = size * (0.16 + wingOpen * 0.3);
  const tipX = side * spread;

  ctx.beginPath();
  ctx.moveTo(side * size * 0.04, -size * 0.16);
  ctx.bezierCurveTo(
    side * size * 0.22,
    -size * 0.86 - lift * 0.24,
    side * spread * 0.76,
    -size * 0.8 - lift * 0.22,
    tipX,
    -size * 0.12 - lift * 0.18,
  );
  ctx.bezierCurveTo(
    side * spread * 0.92,
    size * 0.2 + lift * 0.2,
    side * spread * 0.64,
    size * 0.52 + lift * 0.16,
    side * size * 0.08,
    size * 0.18,
  );
  ctx.closePath();
  ctx.fillStyle = `rgba(212, 243, 255, ${alpha * 0.14})`;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(side * size * 0.06, -size * 0.1);
  ctx.lineTo(side * spread * 0.7, -size * 0.56 - lift * 0.16);
  ctx.lineTo(side * spread * 0.88, -size * 0.08);
  ctx.lineTo(side * spread * 0.58, size * 0.34 + lift * 0.12);
  ctx.closePath();
  ctx.fillStyle = `rgba(244, 253, 255, ${alpha * 0.08})`;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(side * size * 0.08, -size * 0.1);
  ctx.lineTo(side * spread * 0.7, -size * 0.56 - lift * 0.16);
  ctx.moveTo(side * size * 0.08, -size * 0.1);
  ctx.lineTo(side * spread * 0.88, -size * 0.08);
  ctx.moveTo(side * size * 0.08, size * 0.16);
  ctx.lineTo(side * spread * 0.58, size * 0.34 + lift * 0.12);
  ctx.strokeStyle = `rgba(239, 252, 255, ${alpha * 0.38})`;
  ctx.stroke();
}

function drawButterflyWing(ctx, side, size, flap) {
  const wingX = side * size * 0.08;
  const lift = size * (0.08 + flap * 0.1);
  const spread = size * (0.68 + flap * 0.18);

  ctx.beginPath();
  ctx.moveTo(wingX, -size * 0.12);
  ctx.bezierCurveTo(
    side * spread * 0.18,
    -size * 0.72 - lift,
    side * spread * 0.9,
    -size * 0.7 - lift,
    side * spread,
    -size * 0.2,
  );
  ctx.bezierCurveTo(
    side * spread * 0.98,
    size * 0.14 + lift * 0.35,
    side * spread * 0.58,
    size * 0.25 + lift * 0.35,
    side * spread * 0.38,
    size * 0.64 + lift,
  );
  ctx.bezierCurveTo(
    side * spread * 0.2,
    size * 0.74 + lift,
    side * spread * 0.08,
    size * 0.28,
    wingX,
    size * 0.16,
  );
  ctx.closePath();
  ctx.fillStyle = "rgba(222, 244, 255, 0.12)";
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(wingX, -size * 0.04);
  ctx.quadraticCurveTo(
    side * spread * 0.48,
    -size * 0.33,
    side * spread * 0.78,
    -size * 0.2,
  );
  ctx.moveTo(wingX, size * 0.1);
  ctx.quadraticCurveTo(
    side * spread * 0.42,
    size * 0.28,
    side * spread * 0.4,
    size * 0.58,
  );
  ctx.strokeStyle = "rgba(239, 250, 255, 0.24)";
  ctx.stroke();
}

function renderDream(idleMs, dt) {
  const target = idleMs > 1450 && birdEvent.phase === "idle" ? 1 : 0;
  dreamAlpha = lerp(dreamAlpha, target, 0.025 * dt);
  if (dreamAlpha < 0.01) return;

  const breathe = 0.92 + sin(frameCount * 0.018) * 0.08;
  const size = constrain(min(width, height) * 0.047, 22, 42);
  const y = height * 0.48;

  push();
  textAlign(CENTER, CENTER);
  textFont("Arial");
  textStyle(NORMAL);
  textSize(size);
  drawingContext.shadowColor = `rgba(255,255,255,${0.9 * dreamAlpha})`;
  drawingContext.shadowBlur = 12 * breathe;
  fill(255, 255, 255, 225 * dreamAlpha);
  text("dream", width * 0.5, y);
  pop();
}

function registerPointer(x, y) {
  const now = millis();
  const dx = x - pointer.x;
  const dy = y - pointer.y;
  const gap = max(now - pointer.lastMove, 8);
  const frameScale = 16.6667 / gap;

  pointer.px = pointer.x;
  pointer.py = pointer.y;
  pointer.x = constrain(x, 0, width);
  pointer.y = constrain(y, 0, height);
  pointer.vx = lerp(pointer.vx, dx * frameScale, 0.72);
  pointer.vy = lerp(pointer.vy, dy * frameScale, 0.72);
  pointer.speed = lerp(pointer.speed, sqrt(pointer.vx ** 2 + pointer.vy ** 2), 0.65);
  pointer.lastMove = now;
  pointer.active = true;
}

function startPointerTap(event) {
  pointer.down = true;
  tapGesture.pointerId = event.pointerId;
  tapGesture.pointerType = event.pointerType;
  tapGesture.startedAt = millis();
  tapGesture.startX = event.clientX;
  tapGesture.startY = event.clientY;
  tapGesture.moved = false;
  registerPointer(event.clientX, event.clientY);
}

function trackTapMovement(x, y) {
  if (
    Math.hypot(x - tapGesture.startX, y - tapGesture.startY) >
    DREAM_PARAMS.tapMoveTolerance
  ) {
    tapGesture.moved = true;
  }
}

function endPointerTap(event) {
  if (event.pointerId !== tapGesture.pointerId || !pointer.down) return;
  trackTapMovement(event.clientX, event.clientY);
  const now = millis();
  pointer.down = false;
  tapGesture.pointerId = null;

  if (
    tapGesture.moved ||
    (tapGesture.pointerType === "touch" &&
      now - tapGesture.startedAt > DREAM_PARAMS.tapMaxDurationMs) ||
    birdEvent.phase !== "idle"
  ) {
    tapGesture.lastTapAt = -Infinity;
    return;
  }

  if (tapGesture.pointerType !== "touch") {
    tapGesture.lastTapAt = -Infinity;
    startBirdEvent(now);
    return;
  }

  if (
    now - tapGesture.lastTapAt <= DREAM_PARAMS.doubleTapMs &&
    Math.hypot(
      event.clientX - tapGesture.lastTapX,
      event.clientY - tapGesture.lastTapY,
    ) <= DREAM_PARAMS.doubleTapDistance
  ) {
    tapGesture.lastTapAt = -Infinity;
    startBirdEvent(now);
  } else {
    tapGesture.lastTapAt = now;
    tapGesture.lastTapX = event.clientX;
    tapGesture.lastTapY = event.clientY;
  }
}

function cancelPointerTap() {
  pointer.down = false;
  tapGesture.pointerId = null;
  tapGesture.lastTapAt = -Infinity;
}

function emitRipple(x, y, speed) {
  let candidate = ripples[0];
  for (let i = 0; i < ripples.length; i += 1) {
    if (!ripples[i].active) {
      candidate = ripples[i];
      break;
    }
    if (ripples[i].life < candidate.life) candidate = ripples[i];
  }
  candidate.reset(x, y, speed);
}

function updateRipples(dt) {
  for (let i = 0; i < ripples.length; i += 1) {
    ripples[i].update(dt);
  }
}

class Strand {
  constructor(anchorX, index) {
    this.anchorX = anchorX;
    this.index = index;
    this.phase = random(TWO_PI);
    this.endRatio = random(0.7, 1.08);
    this.lowerStart = random(0.38, 0.58);
    this.swayAmount = random(width * 0.018, width * 0.085);
    this.swayRate = random(0.55, 1.25);
    this.swayBias = random(-1, 1);
    this.offsets = new Float32Array(STRAND_NODES);
    this.velocities = new Float32Array(STRAND_NODES);
  }

  update(dt) {
    const time = frameCount * 0.008;
    const endY = height * this.endRatio;
    for (let i = 1; i < STRAND_NODES; i += 1) {
      const progress = i / (STRAND_NODES - 1);
      const y = progress * endY;
      const lowerProgress = constrain(
        (progress - this.lowerStart) / (1 - this.lowerStart),
        0,
        1,
      );
      const lowerSway = pow(lowerProgress, 1.35);
      const windWave =
        sin(time * this.swayRate + this.phase + i * 0.58) * this.swayAmount;
      const secondaryWave =
        cos(time * this.swayRate * 0.63 + this.phase * 1.7 + i) *
        this.swayAmount *
        0.34;
      const idleWave =
        (windWave + secondaryWave + this.swayBias * this.swayAmount * 0.16) *
        lowerSway;
      const spring = -(this.offsets[i] - idleWave) * (0.026 - lowerProgress * 0.007);
      const neighbor =
        ((this.offsets[i - 1] || 0) +
          (i < STRAND_NODES - 1 ? this.offsets[i + 1] : this.offsets[i])) *
          0.5 -
        this.offsets[i];

      this.velocities[i] += (spring + neighbor * 0.07) * dt;

      const dx = this.anchorX + this.offsets[i] - butterfly.x;
      const dy = y - butterfly.y;
      {
        const distanceSq = dx * dx + dy * dy;
        const radius = butterfly.speed < 9 ? 170 : 220;
        if (distanceSq < radius * radius) {
          const influence = 1 - sqrt(distanceSq) / radius;
          const push =
            butterfly.speed < 9 ? -dx * 0.002 : butterfly.vx * 0.095;
          this.velocities[i] += push * influence * dt;
        }
      }

      this.velocities[i] *= pow(0.91, dt);
      this.offsets[i] += this.velocities[i] * dt;
      this.offsets[i] = constrain(this.offsets[i], -width * 0.16, width * 0.16);
    }
    this.offsets[0] = 0;
  }

  xAt(y) {
    const normalized = constrain(y / (height * this.endRatio), 0, 0.9999) *
      (STRAND_NODES - 1);
    const index = floor(normalized);
    const mix = normalized - index;
    return (
      this.anchorX +
      lerp(this.offsets[index], this.offsets[min(index + 1, STRAND_NODES - 1)], mix)
    );
  }

  render(g) {
    const ctx = g.drawingContext;
    const points = [];
    for (let i = 0; i < STRAND_NODES; i += 1) {
      const y =
        (i / (STRAND_NODES - 1)) * height * this.endRatio - 10;
      points.push([this.anchorX + this.offsets[i], y]);
    }

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i += 1) {
      const midpointX = (points[i][0] + points[i + 1][0]) * 0.5;
      const midpointY = (points[i][1] + points[i + 1][1]) * 0.5;
      ctx.quadraticCurveTo(points[i][0], points[i][1], midpointX, midpointY);
    }
    const lastPoint = points[points.length - 1];
    ctx.lineTo(lastPoint[0], lastPoint[1]);
    ctx.strokeStyle = "rgba(235, 244, 255, 0.28)";
    ctx.stroke();
  }
}

class GlyphParticle {
  constructor(index) {
    this.index = index;
    this.strandIndex = index % STRAND_COUNT;
    this.reset(null, true);
  }

  reset(y = null, initial = false) {
    this.strandIndex = this.index % STRAND_COUNT;
    const strand = strands[this.strandIndex];
    const maxY = height * strand.endRatio;
    const slot = floor(this.index / STRAND_COUNT);
    const slotSpacing = maxY / (glyphsPerStrand + 1);
    if (initial || y === null || y < -height * 0.18 || y > maxY) {
      y =
        slotSpacing * (slot + 1) +
        random(-slotSpacing * 0.32, slotSpacing * 0.32);
    }
    this.y = y;
    this.x = strand.xAt(constrain(y, 0, maxY));
    this.x += randomGaussian() * 2.5;
    this.vx = random(-0.08, 0.08);
    this.vy = random(0.04, 0.18);
    this.size = random(5.5, min(width, height) < 700 ? 10.5 : 12.5);
    this.alpha = random(105, 220);
    this.phase = random(TWO_PI);
    this.noiseOffset = random(1000);
    this.glyphIndex = floor(random(GLYPHS.length));
    this.glyphSizeIndex = floor(random(GLYPH_SIZES.length));
    this.scale = random(0.86, 1.14);
    this.flash = initial ? random(0, 0.35) : 0;
  }

  captureBird(centerX, centerY) {
    const target = birdTargetFor(this.index, DREAM_PARAMS.birdWingOpenMin);
    this.birdStartX = this.x;
    this.birdStartY = this.y;
    this.birdTargetX = centerX + target.x;
    this.birdTargetY = centerY + target.y;
    this.flash = 0.32;
  }

  updateBird(now) {
    const pose = birdPoseAt(now);
    const wingOpen = birdWingOpenAt(now);
    const target = birdTargetFor(this.index, wingOpen);
    const elapsed = now - birdEvent.startedAt;
    let progress = 1;

    if (birdEvent.phase === "gather") {
      progress = constrain(elapsed / DREAM_PARAMS.birdGatherMs, 0, 1);
      progress = progress * progress * (3 - 2 * progress);
    }

    const targetX = pose.x + target.x;
    const targetY = pose.y + target.y;
    const flutterX =
      sin(now * 0.012 + this.phase) * (birdEvent.phase === "hold" ? 1.4 : 0.7);
    const flutterY =
      cos(now * 0.01 + this.phase * 1.4) * (birdEvent.phase === "hold" ? 1.1 : 0.5);

    if (birdEvent.phase === "gather") {
      this.x = lerp(this.birdStartX, targetX, progress);
      this.y = lerp(this.birdStartY, targetY, progress);
    } else {
      this.x = targetX + flutterX;
      this.y = targetY + flutterY;
    }
    this.vx = 0;
    this.vy = 0;
    this.angle = sin(now * 0.008 + this.phase) * 0.12;
  }

  update(dt, now) {
    if (birdEvent.phase !== "idle") {
      this.updateBird(now);
      return;
    }

    const strand = strands[this.strandIndex];
    const flow =
      (noise(this.noiseOffset, this.y * 0.0025, frameCount * 0.0025) - 0.5) * 0.16;
    const targetX = strand.xAt(this.y) + sin(this.phase + frameCount * 0.014) * 1.8;

    this.vx += (targetX - this.x) * 0.0065 * dt;
    this.vx += flow * dt;
    this.vy += 0.006 * dt;

    const dx = butterfly.x - this.x;
    const dy = butterfly.y - this.y;
    const distanceSq = dx * dx + dy * dy;
    const isFast = butterfly.speed >= 8;
    const radius = (isFast ? 190 : 145) * min(width / 390, 1.2);

    if (distanceSq < radius * radius && distanceSq > 1) {
      const distance = sqrt(distanceSq);
      const influence = pow(1 - distance / radius, 1.7);
      if (isFast) {
        const speedForce = constrain(butterfly.speed / 24, 0.25, 1.6);
        this.vx += butterfly.vx * 0.055 * influence * speedForce * dt;
        this.vy += butterfly.vy * 0.018 * influence * speedForce * dt;
        this.vy += sin(dx * 0.045 + now * 0.018) * 0.12 * influence * dt;
        this.flash = min(1, this.flash + influence * 0.22);
      } else {
        const attraction = 0.012 * influence;
        this.vx += dx * attraction * dt;
        this.vy += dy * attraction * 0.42 * dt;
        this.vy *= 0.985;
        this.flash = min(0.8, this.flash + influence * 0.06);
      }
    }

    for (let i = 0; i < ripples.length; i += 1) {
      const ripple = ripples[i];
      if (!ripple.active) continue;
      const dx = this.x - ripple.x;
      const dy = this.y - ripple.y;
      const distance = sqrt(dx * dx + dy * dy);
      const edgeDistance = abs(distance - ripple.radius);
      if (edgeDistance < ripple.width && distance > 1) {
        const force = (1 - edgeDistance / ripple.width) * ripple.life * 0.15;
        this.vx += (dx / distance) * force * ripple.direction;
        this.vy += (dy / distance) * force * 0.28;
      }
    }

    this.vx *= pow(0.94, dt);
    this.vy *= pow(0.994, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.flash *= pow(0.94, dt);

    if (
      this.y > height * strand.endRatio + 16 ||
      this.x < -width * 0.25 ||
      this.x > width * 1.25
    ) {
      this.reset();
    }
  }

  render(g, now) {
    const flicker = 0.82 + sin(now * 0.004 + this.phase) * 0.18;
    const fogFade = map(this.y, height * 0.72, height, 1, 0.3, true);
    let alpha = this.alpha * flicker * fogFade + this.flash * 72;
    if (birdEvent.phase === "flight") {
      const progress = birdPoseAt(now).flightProgress;
      alpha *= 1 - progress * 0.72;
    } else if (birdEvent.phase !== "idle") {
      alpha *= 0.66;
    }
    const ctx = g.drawingContext;
    const sourceX = this.glyphIndex * GLYPH_CELL * GLYPH_ATLAS_DENSITY;
    const sourceY = this.glyphSizeIndex * GLYPH_CELL * GLYPH_ATLAS_DENSITY;
    const sourceCell = GLYPH_CELL * GLYPH_ATLAS_DENSITY;
    const destinationCell =
      GLYPH_CELL * this.scale * (1 + this.flash * 0.18);

    if (this.flash > 0.16 && birdEvent.phase === "idle") {
      ctx.globalAlpha = min(0.16, alpha / 900);
      ctx.drawImage(
        glyphAtlas,
        sourceX,
        sourceY,
        sourceCell,
        sourceCell,
        this.x - destinationCell * 0.78,
        this.y - destinationCell * 0.78,
        destinationCell * 1.56,
        destinationCell * 1.56,
      );
    }

    ctx.globalAlpha = constrain(alpha / 255, 0, 1);
    ctx.drawImage(
      glyphAtlas,
      sourceX,
      sourceY,
      sourceCell,
      sourceCell,
      this.x - destinationCell * 0.5,
      this.y - destinationCell * 0.5,
      destinationCell,
      destinationCell,
    );
  }
}

class Ripple {
  constructor() {
    this.active = false;
    this.life = 0;
  }

  reset(x, y, speed) {
    this.active = true;
    this.x = x;
    this.y = y;
    this.radius = 8;
    this.width = constrain(46 + speed, 48, 100);
    this.life = 1;
    this.velocity = constrain(4 + speed * 0.18, 5, 13);
    this.direction = random() > 0.25 ? 1 : -1;
  }

  update(dt) {
    if (!this.active) return;
    this.radius += this.velocity * dt;
    this.life -= 0.028 * dt;
    if (this.life <= 0) {
      this.active = false;
      this.life = 0;
    }
  }

  render(g) {
    if (!this.active) return;
    const ctx = g.drawingContext;
    ctx.globalAlpha = this.life;
    ctx.strokeStyle = "rgba(238, 247, 255, 0.34)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(
      this.x,
      this.y,
      this.radius,
      this.radius * 0.36,
      0,
      0,
      TWO_PI,
    );
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function mouseMoved() {
  registerPointer(mouseX, mouseY);
  return false;
}

function mouseDragged() {
  registerPointer(mouseX, mouseY);
  return false;
}

function touchStarted() {
  if (touches.length === 1) {
    registerPointer(touches[0].x, touches[0].y);
  } else if (touches.length > 1) {
    tapGesture.moved = true;
    tapGesture.lastTapAt = -Infinity;
  }
  return false;
}

function touchMoved() {
  if (touches.length > 0) {
    registerPointer(touches[0].x, touches[0].y);
  }
  return false;
}

function touchEnded() {
  return false;
}

function windowResized() {
  cancelPointerTap();
  resizeCanvas(windowWidth, windowHeight);
  pixelDensity(getRenderDensity());
  createLayers();
  buildScene();
  pointer.x = pointer.px = width * 0.5;
  pointer.y = pointer.py = height * 0.5;
  butterfly.x = width * 0.5;
  butterfly.y = height * 0.5;
  butterfly.vx = 0;
  butterfly.vy = 0;
}
