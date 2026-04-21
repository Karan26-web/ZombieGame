/**
 * Zombie Hop  –  v6
 *
 *  1. Flesh chunks replace coins — zombie eats raw meat to score.
 *  2. Five named levels (Graveyard → Blood Moon) with speed jumps.
 *  3. Zombie foot-line origin corrected to actual shoe sole pixel.
 */

// ─── LOGICAL RESOLUTION ───────────────────────────────────────────────────────
const W = 900, H = 420;

// ─── PHYSICS ─────────────────────────────────────────────────────────────────
const GRAVITY = 1500;
const JUMP_VEL      = -660;   // normal jump  (~192 px arc)
const JUMP_VEL_HIGH = -880;   // super jump   (~320 px arc)
const AIR_TIME = (2 * 760) / 1500;  // ≈ 1.013 s
const JUMP_ENABLED = true;
const CONTINUOUS_GROUND = false;
const FLAT_PLATFORM_PATH = true;

// ─── SPEED / DIFFICULTY ──────────────────────────────────────────────────────
const INIT_SPD = 190;
const MAX_SPD = 420;
const SPD_STEP = 12;
const DIFF_MS = 6500;

// ─── LEVELS ──────────────────────────────────────────────────────────────────
const LEVELS = [
  { minDist:    0, name: 'GRAVEYARD',    baseSpd: 190 },
  { minDist:  600, name: 'DEAD STREETS', baseSpd: 240 },
  { minDist: 1500, name: 'THE CRYPT',    baseSpd: 295 },
  { minDist: 2800, name: "HELL'S GATE",  baseSpd: 345 },
  { minDist: 4500, name: 'BLOOD MOON',   baseSpd: 390 },
];

// ─── LAYOUT ──────────────────────────────────────────────────────────────────
const PLAYER_X = 130;
const TILE_W = 200;
const CAP_H = 14;
const DIRT_H = 44;
const PLAT_H = CAP_H + DIRT_H ;        // 58 px total
const GAP_MIN = 68;
const GROUND_Y = Math.round(H * 0.73);  // ≈ 307
const INPUT_GRACE_MS = 260;
const MAX_FRAME_MS = 34;
const OVERLAY_WORDMARK_W = 420;
const TRACE_UI = typeof window !== 'undefined' && /[?&]trace=1\b/.test(window.location.search);
const AUTO_START = typeof window !== 'undefined' && /[?&]autostart=1\b/.test(window.location.search);

// ─── LAND ELEMENT SPRITES ────────────────────────────────────────────────────
// Each entry: image size (iw×ih) and the Y-fraction where the grass cap starts.
// At LAND_SCALE, rw = rendered width used for physics body width.
const LAND_SCALE = 0.2;
const LAND_CFGS = {
  land1: { iw: 1508, ih: 608, capFrac: 436 / 608 },   // floating platform w/ sign/tombstone/tree
  land4: { iw: 1613, ih: 666, capFrac: 188 / 666 },   // floating platform w/ sign/skull/bush
};
Object.values(LAND_CFGS).forEach(c => {
  c.rw = Math.round(c.iw * LAND_SCALE);
  c.rh = Math.round(c.ih * LAND_SCALE);
});

// ─── FLESH CHUNKS ────────────────────────────────────────────────────────────
const FLESH_VAL = 10;
const FLESH_HOVER = 14;   // float above platform surface
const FLESH_BOB = 0;
const FLESH_SPEED = 0.003;
const FLESH_R2 = 20 * 20; // squared collection radius
const FLESH_PATH_INSET = 34;

// ─── PALETTE ─────────────────────────────────────────────────────────────────
const C = {
  skyTop: 0x03040b, skyBot: 0x0a1422,
  moonW: 0xf6ffff, moonM: 0xd0e8f8, moonG: 0xa8c8e8,
  hFar: 0x071018, hNr: 0x0a1624,
  // Platform: bright teal grass cap + warm brown dirt
  capT: 0x7de8c0, capB: 0x4dba88, capR: 0x2e8c60,
  drtB: 0x8b5e2d, drtD: 0x5c3412, drtL: 0xb07840,
  skin: 0x70b070, shDk: 0x2d4828, shLt: 0x3c5c38,
  pant: 0x223022, shoe: 0x160d05, brai: 0xc03020,
  wht: 0xffffff, red: 0xff2020,
  // Decorations: more saturated for visibility
  skul: 0xf0e6c0, crWd: 0xa06828, crX: 0xe04020,
  tomb: 0x8899aa, bone: 0xe8ddb8,
  sgnB: 0x8b5c28, sgnP: 0xa07040,
  bshG: 0x3daa5c, bshL: 0x5dd878,
  treeC: 0x2a1808,
};

// ─── PROCEDURAL SOUND ENGINE (Web Audio API – no files, copyright-free) ──────
const Sfx = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Resume in case browser suspended it before first user gesture
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Generic one-shot tone helper
  function tone({ type = 'square', freq = 440, freq2 = freq, gain = 0.18, duration = 0.12, attack = 0.004, decay = 0.08 }) {
    const c = getCtx();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.connect(amp);
    amp.connect(c.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq2, t + duration);

    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);

    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  return {
    jump() {
      // Short upward chirp
      tone({ type: 'square', freq: 260, freq2: 520, gain: 0.14, duration: 0.12, attack: 0.005, decay: 0.10 });
    },

    jumpHigh() {
      // Double chirp — higher and longer arc
      tone({ type: 'square', freq: 260, freq2: 540, gain: 0.14, duration: 0.10, attack: 0.005, decay: 0.09 });
      tone({ type: 'square', freq: 440, freq2: 880, gain: 0.12, duration: 0.14, attack: 0.04,  decay: 0.12 });
    },

    land() {
      // Soft thud – low sine blip
      tone({ type: 'sine', freq: 130, freq2: 80, gain: 0.20, duration: 0.06, attack: 0.002, decay: 0.05 });
    },

    flesh() {
      // Wet squelch — low thump + short high blip
      tone({ type: 'triangle', freq: 160, freq2: 100, gain: 0.24, duration: 0.10, attack: 0.003, decay: 0.09 });
      tone({ type: 'sine',     freq: 740, freq2: 560, gain: 0.10, duration: 0.07, attack: 0.002, decay: 0.06 });
    },

    levelUp() {
      // Rising horn stab for level advance
      tone({ type: 'square', freq: 330, freq2: 660, gain: 0.18, duration: 0.18, attack: 0.005, decay: 0.16 });
      tone({ type: 'square', freq: 440, freq2: 880, gain: 0.14, duration: 0.18, attack: 0.06,  decay: 0.16 });
    },

    die() {
      // Descending buzzy sweep
      tone({ type: 'sawtooth', freq: 400, freq2: 80, gain: 0.22, duration: 0.45, attack: 0.005, decay: 0.42 });
    },

    speedUp() {
      // Quick ascending blip for difficulty ramp
      tone({ type: 'sine', freq: 600, freq2: 900, gain: 0.10, duration: 0.10, attack: 0.003, decay: 0.09 });
    },
  };
})();

// ─── BACKEND ─────────────────────────────────────────────────────────────────
const API = 'http://localhost:5001/api';
let sessionId = null, playerName = 'Player';
let preparedAssetsPromise = null;
let preparedAssets = null;

async function apiPost(path, body = {}) {
  try {
    const r = await fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok ? r.json() : null;
  } catch { return null; }
}
async function apiGet(path) {
  try { const r = await fetch(API + path); return r.ok ? r.json() : null; }
  catch { return null; }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // img.decode() waits for pixel data to be fully rasterised before we
      // hand the element to Phaser's WebGL texture manager.  Without this,
      // textures.addImage() received undecoded image data and silently
      // produced an empty/missing texture, crashing the try-block in
      // BootScene.create() before buildTextures() ever ran.
      if (typeof img.decode === 'function') {
        img.decode().then(() => resolve(img), () => resolve(img));
      } else {
        resolve(img);
      }
    };
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

async function loadImageWithFallback(name, sources) {
  let lastErr = null;
  for (const src of sources) {
    try {
      return await loadImageElement(src);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Failed to load ${name}${lastErr ? ` (${lastErr.message})` : ''}`);
}

function resolveAssetPath(filename) {
  const relativePath = `../assets/${filename}`;
  if (typeof window === 'undefined' || !window.location?.href) return relativePath;
  return new URL(relativePath, window.location.href).toString();
}

function getAssetSources() {
  // If embedded data URIs are present, try them first. Otherwise resolve the
  // repo-level assets folder relative to the current entry point.
  const globals = typeof window !== 'undefined' ? window : globalThis;
  const uri = (name) => (typeof globals[name] !== 'undefined' ? globals[name] : null);
  return {
    bg: [uri('ASSET_BG'), resolveAssetPath('background.png')].filter(Boolean),
    zombie: [uri('ASSET_ZOMBIE'), resolveAssetPath('Zombie.png')].filter(Boolean),
    land1: [uri('ASSET_LAND1'), resolveAssetPath('landElement1.png')].filter(Boolean),
    land4: [uri('ASSET_LAND4'), resolveAssetPath('landElement4.png')].filter(Boolean),
    getReadyImg: [uri('ASSET_GETREADY'), resolveAssetPath('getReadyText.png')].filter(Boolean),
    gameOverImg: [uri('ASSET_GAMEOVER'), resolveAssetPath('gameOverText.png')].filter(Boolean),
  };
}

async function prepareGameAssets() {
  if (preparedAssets) return preparedAssets;
  if (!preparedAssetsPromise) {
    preparedAssetsPromise = (async () => {
      const sources = getAssetSources();

      // bg + zombie are required; throws if every source fails
      const [bg, zombie] = await Promise.all([
        loadImageWithFallback('background', sources.bg),
        loadImageWithFallback('zombie', sources.zombie),
      ]);

      // Optional assets – null on failure (game degrades gracefully)
      const optKeys = ['land1', 'land4', 'getReadyImg', 'gameOverImg'];
      const settled = await Promise.allSettled(
        optKeys.map(k => loadImageWithFallback(k, sources[k]))
      );
      const opts = Object.fromEntries(
        optKeys.map((k, i) => [k, settled[i].status === 'fulfilled' ? settled[i].value : null])
      );

      preparedAssets = { bg, zombie, ...opts };
      return preparedAssets;
    })().catch(err => { preparedAssetsPromise = null; throw err; });
  }
  return preparedAssetsPromise;
}

// ─── TEXTURE BUILDER ─────────────────────────────────────────────────────────
function buildTextures(scene) {
  // Must use scene.add.graphics() (adds to display list) so that WebGL's
  // generateTexture TargetCamera can render the geometry. Destroyed after use.
  const g = scene.add.graphics({ x: 0, y: 0 });

  /* PLATFORM TILE  200 × 58 */
  g.clear();
  g.fillStyle(C.capB); g.fillRect(0, 0, TILE_W, CAP_H);
  g.fillStyle(C.capT, 0.85); g.fillRect(0, 0, TILE_W, 5);
  g.fillStyle(C.capR, 0.60); g.fillRect(0, CAP_H - 3, TILE_W, 3);
  g.fillStyle(C.drtB); g.fillRect(0, CAP_H, TILE_W, DIRT_H);
  g.fillStyle(C.drtD);
  [[10, 5, 14, 10], [35, 14, 13, 9], [62, 4, 16, 10], [90, 9, 13, 9], [116, 4, 15, 10],
  [142, 13, 13, 9], [168, 4, 14, 10], [20, 20, 14, 9], [52, 19, 16, 10], [82, 22, 13, 8],
  [110, 19, 15, 9], [140, 18, 13, 8], [165, 22, 12, 8], [28, 32, 13, 8], [58, 28, 15, 9],
  [90, 32, 14, 9], [120, 29, 13, 8], [153, 27, 12, 8], [185, 18, 13, 9]]
    .forEach(([x, y, w, h]) => g.fillEllipse(x, CAP_H + y, w, h));
  g.fillStyle(C.drtL);
  [[24, 8, 7, 5], [55, 17, 6, 4], [87, 6, 5, 4], [114, 15, 7, 4], [146, 9, 7, 5], [178, 20, 5, 4]]
    .forEach(([x, y, w, h]) => g.fillEllipse(x, CAP_H + y, w, h));
  g.generateTexture('platform', TILE_W, PLAT_H);

  /* SKULL  30 × 24 */
  g.clear();
  g.fillStyle(C.skul);
  g.fillEllipse(15, 11, 28, 20); g.fillRect(9, 15, 12, 9);
  g.fillStyle(C.drtD);
  g.fillEllipse(10, 11, 8, 9); g.fillEllipse(20, 11, 8, 9);
  g.fillRect(9, 20, 3, 5); g.fillRect(13, 20, 3, 5); g.fillRect(17, 20, 3, 5);
  g.generateTexture('skull', 30, 24);

  /* CRATE  36 × 36 */
  g.clear();
  g.fillStyle(C.crWd); g.fillRect(1, 1, 34, 34);
  g.fillStyle(0xffffff, 0.12); g.fillRect(1, 1, 34, 5);
  g.fillStyle(0x000000, 0.25);
  g.fillRect(0, 0, 36, 2); g.fillRect(0, 34, 36, 2);
  g.fillRect(0, 0, 2, 36); g.fillRect(34, 0, 2, 36);
  g.fillStyle(0x000000, 0.15); g.fillRect(0, 17, 36, 2); g.fillRect(17, 0, 2, 36);
  g.fillStyle(C.crX);
  for (let i = 0; i < 10; i++) { g.fillRect(4 + i * 3, 4 + i * 3, 3, 3); g.fillRect(28 - i * 3, 4 + i * 3, 3, 3); }
  g.generateTexture('crate', 36, 36);

  /* TOMBSTONE  24 × 36 */
  g.clear();
  g.fillStyle(C.tomb);
  g.fillRect(6, 16, 12, 20); g.fillEllipse(12, 16, 18, 24);
  g.fillStyle(0x96a5a6); g.fillRect(9, 18, 6, 2); g.fillRect(11, 15, 2, 6);
  g.fillStyle(0x5d6d6e); g.fillRect(6, 16, 3, 20);
  g.generateTexture('tombstone', 24, 36);

  /* BONE  26 × 10 */
  g.clear();
  g.fillStyle(C.bone);
  g.fillEllipse(5, 5, 10, 10); g.fillEllipse(21, 5, 10, 10); g.fillRect(5, 2, 16, 6);
  g.generateTexture('bone', 26, 10);

  /* SIGN  28 × 42 */
  g.clear();
  g.fillStyle(C.sgnP); g.fillRect(11, 0, 5, 42);
  g.fillStyle(C.sgnB); g.fillRect(0, 9, 28, 22);
  g.fillStyle(0xffffff, 0.1); g.fillRect(0, 9, 28, 4);
  g.fillStyle(0x5a3818, 0.35);
  g.fillRect(0, 15, 28, 1); g.fillRect(0, 21, 28, 1); g.fillRect(0, 27, 28, 1);
  g.generateTexture('sign', 28, 42);

  /* BUSH  40 × 26 */
  g.clear();
  g.fillStyle(C.bshG);
  g.fillEllipse(12, 18, 22, 20); g.fillEllipse(28, 17, 22, 20); g.fillEllipse(20, 12, 26, 22);
  g.fillStyle(C.bshL, 0.55); g.fillEllipse(14, 9, 16, 14); g.fillEllipse(24, 10, 14, 12);
  g.generateTexture('bush', 40, 26);

  /* DEAD TREE  54 × 120 */
  g.clear();
  g.fillStyle(C.treeC);
  g.fillRect(24, 28, 8, 92); g.fillRect(10, 52, 16, 6); g.fillRect(10, 42, 6, 16);
  g.fillRect(4, 38, 8, 5); g.fillRect(30, 44, 20, 6); g.fillRect(44, 30, 6, 22);
  g.fillRect(44, 26, 10, 5); g.fillRect(18, 60, 8, 5); g.fillRect(32, 58, 12, 5);
  g.fillRect(21, 34, 5, 18); g.fillRect(30, 30, 5, 20);
  g.generateTexture('tree', 54, 120);

  /* FLESH CHUNK  26 × 22  (raw meat piece with bone nub) */
  g.clear();
  g.fillStyle(0x6e0e00); g.fillEllipse(13, 11, 24, 20);   // dark base shadow
  g.fillStyle(0xc01808); g.fillEllipse(12, 10, 20, 16);   // main meat body
  g.fillStyle(0xe83020); g.fillEllipse(10,  8, 14, 11);   // bright highlight
  g.fillStyle(0xffd0c0, 0.35); g.fillEllipse(8, 6, 8, 6); // fat shine
  g.fillStyle(0xfff0ee, 0.20);                             // marbling streaks
  g.fillRect(9, 5, 1, 9); g.fillRect(13, 6, 1, 8);
  // Bone nub (right side)
  g.fillStyle(0xf0e6c0);
  g.fillCircle(22, 5, 4);
  g.fillRect(20, 5, 4, 9);
  g.fillCircle(22, 14, 3);
  g.generateTexture('flesh', 26, 22);

  /* TERRAIN FILL  96 × 96 */
  g.clear();
  g.fillStyle(0x6f4526); g.fillRect(0, 0, 96, 96);
  g.fillStyle(0x4a2710, 0.95);
  [[8, 10, 18, 8], [28, 20, 14, 9], [55, 13, 17, 10], [74, 26, 15, 10], [18, 42, 13, 8],
  [42, 36, 18, 11], [70, 48, 20, 12], [10, 68, 17, 10], [34, 72, 14, 9], [58, 66, 16, 10], [80, 78, 13, 8]]
    .forEach(([x, y, w, h]) => g.fillEllipse(x, y, w, h));
  g.fillStyle(0x8c5a37, 0.9);
  [[14, 24, 8, 5], [37, 11, 7, 5], [63, 31, 8, 5], [81, 16, 7, 5], [24, 56, 8, 5], [52, 51, 7, 5], [76, 60, 8, 5]]
    .forEach(([x, y, w, h]) => g.fillEllipse(x, y, w, h));
  g.fillStyle(0x2f180a, 0.55); g.fillRect(0, 0, 96, 8);
  g.generateTexture('terrainFill', 96, 96);

  g.destroy();
}

function getChunkBottomY(topY, landKey = null) {
  if (landKey && LAND_CFGS[landKey]) {
    const cfg = LAND_CFGS[landKey];
    return topY + (cfg.rh * (1 - cfg.capFrac));
  }
  return topY + PLAT_H;
}

function createChunkVisual(scene, { leftX, topY, width, landKey = null, fillDepth = 0, fillInset = 14, depth = 3, alpha = 1 }) {
  const visuals = [];
  let top;

  if (landKey && scene.textures.exists(landKey)) {
    const cfg = LAND_CFGS[landKey];
    // Crop the image to only show cap+dirt (hide tall baked-in decorations above
    // the grass cap, which would obscure the zombie standing on the surface).
    const capY = Math.round(cfg.capFrac * cfg.ih);
    top = scene.add.image(leftX, topY, landKey)
      .setOrigin(0, cfg.capFrac)
      .setScale(LAND_SCALE)
      .setCrop(0, capY, cfg.iw, cfg.ih - capY)
      .setDepth(depth)
      .setAlpha(alpha);
  } else {
    landKey = null;
    top = scene.add.tileSprite(leftX, topY, width, PLAT_H, 'platform')
      .setOrigin(0, 0)
      .setDepth(depth)
      .setAlpha(alpha);
  }
  visuals.push({ sprite: top, offsetX: 0 });

  const baseBottom = getChunkBottomY(topY, landKey);
  if (fillDepth > 0) {
    const inset = Math.min(fillInset, Math.max(10, Math.floor(width * 0.18)));
    const fillWidth = Math.max(48, width - (inset * 2));
    const fill = scene.add.tileSprite(leftX + inset, baseBottom - 6, fillWidth, fillDepth, 'terrainFill')
      .setOrigin(0, 0)
      .setDepth(depth - 1)
      .setAlpha(alpha);
    const underShadow = scene.add.rectangle(leftX + (width / 2), baseBottom - 4, width * 0.9, 16, 0x000000, 0.16)
      .setOrigin(0.5, 0.5)
      .setDepth(depth - 0.5);
    visuals.push({ sprite: fill, offsetX: inset });
    visuals.push({ sprite: underShadow, offsetX: width / 2 });
  }

  return { top, visuals, bottomY: baseBottom + fillDepth };
}

// ─── SHARED BACKGROUND ───────────────────────────────────────────────────────
function addBackground(scene) {
  // Use the real graveyard background image, scaled to fill the canvas.
  scene.add.image(W / 2, H / 2, 'bg').setDisplaySize(W, H).setDepth(0);
}

// ─── ZOMBIE SPRITE SCALE ─────────────────────────────────────────────────────
// Zombie.png is 576×576 px. Last opaque row is 497, foot bottom at 498.
// Phaser arcade body formula: body.pos = go.pos + scale*(offset - displayOrigin)
// where displayOrigin = originFrac * frameSize (unscaled pixels).
// Offsets are expressed in unscaled frame pixel units.
const ZOMBIE_SCALE = 0.145;
const ZOMBIE_W = 576;
const ZOMBIE_H = 576;
const ZOMBIE_FOOT_Y = 900;
const ZOMBIE_ORIGIN_Y = ZOMBIE_FOOT_Y / ZOMBIE_H;
const ZOMBIE_BODY_W = 36;
const ZOMBIE_BODY_H = 68;
// Center body on zombie.x: offset.x = (W - bodyW/scale) / 2
const ZOMBIE_BODY_OFF_X = Math.round((ZOMBIE_W - ZOMBIE_BODY_W / ZOMBIE_SCALE) / 2);
// Place body bottom at foot (zombie.y): offset.y = FOOT_Y - bodyH/scale
const ZOMBIE_BODY_OFF_Y = Math.round(ZOMBIE_FOOT_Y - ZOMBIE_BODY_H / ZOMBIE_SCALE);
const LANDING_TOL = 8;

// ─── BOOT SCENE ──────────────────────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super({ key: 'BootScene' }); }

  preload() {
    const d = document.getElementById('diag');
    const sources = getAssetSources();

    if (d) d.textContent = 'boot:loading';
    this.load.on('progress', (value) => {
      if (d) d.textContent = 'boot:loading ' + Math.round(value * 100) + '%';
    });

    // Load from embedded data URLs first so file:// and localhost behave
    // the same way without depending on pre-decoded <img> elements.
    this.load.image('bg', sources.bg[0]);
    this.load.image('zombie', sources.zombie[0]);
    ['land1', 'land4', 'getReadyImg', 'gameOverImg'].forEach((key) => {
      if (sources[key]?.[0]) this.load.image(key, sources[key][0]);
    });
  }

  create() {
    var d = document.getElementById('diag');
    if (d) d.textContent = 'boot:create';
    let bootOk = false;
    try {
      if (!this.textures.exists('bg') || !this.textures.exists('zombie')) {
        throw new Error('Required textures failed to load');
      }
      buildTextures(this);
      bootOk = true;
    } catch (e) {
      if (d) d.textContent = 'tex-err:' + (e.message || String(e)).slice(0, 60);
      console.error('BootScene.create failed:', e);
      this.cameras.main.setBackgroundColor('#03040b');
      this.add.text(W / 2, H / 2, 'Boot failed\nReload the page', {
        fontFamily: '"Courier New",monospace',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#f0c040',
        align: 'center',
        stroke: '#000',
        strokeThickness: 6,
      }).setOrigin(0.5);
    }
    if (!bootOk) return;
    if (AUTO_START) {
      if (d) d.textContent = 'boot->game';
      this.scene.start('GameScene');
      return;
    }
    if (d) d.textContent = 'boot->menu';
    this.scene.start('MenuScene');
  }
}

// ─── MENU SCENE ──────────────────────────────────────────────────────────────
class MenuScene extends Phaser.Scene {
  constructor() { super({ key: 'MenuScene' }); }

  create() {
    this.starting = false;
    var d = document.getElementById('diag');
    if (d) d.textContent = 'menu:create';
    try {
      addBackground(this);
      if (d) d.textContent = 'menu:bg';

      const wide1 = this.textures.exists('land1') ? LAND_CFGS.land1.rw : 320;
      const wide4 = this.textures.exists('land4') ? LAND_CFGS.land4.rw : 330;
      [
        { leftX: -12, topY: 250, width: 150, fillDepth: 170, depth: 4 },
        { leftX: 208, topY: 156, width: wide1, landKey: 'land1', fillDepth: 30, depth: 4 },
        { leftX: 430, topY: 320, width: wide4, landKey: 'land4', fillDepth: 78, depth: 4 },
        { leftX: 664, topY: 114, width: wide4, landKey: 'land4', fillDepth: 92, depth: 4 },
      ].forEach((cfg) => createChunkVisual(this, cfg));

      this.add.image(78, 248, 'bush').setOrigin(0.5, 1).setScale(1.05).setDepth(5);
      this.add.image(104, 248, 'tombstone').setOrigin(0.5, 1).setScale(1.02).setDepth(5);
      if (d) d.textContent = 'menu:ground';

      const title = this.add.text(18, 18, 'ZOMBIE HOP', {
        fontFamily: '"Courier New",monospace', fontSize: '18px', fontStyle: 'bold',
        color: '#f0c040', stroke: '#000', strokeThickness: 5,
      }).setOrigin(0, 0).setDepth(20);
      if (d) d.textContent = 'menu:title';

      this.add.text(20, 42, 'graveyard run', {
        fontFamily: '"Courier New",monospace', fontSize: '9px', color: '#7de8c0',
      }).setOrigin(0, 0).setDepth(20);

      const startPanel = this.add.rectangle(112, 92, 184, 54, 0x000000, 0.45)
        .setStrokeStyle(2, 0x4dba88, 0.55)
        .setDepth(19);

      const btn = this.add.text(112, 76, '  PLAY  ', {
        fontFamily: '"Courier New",monospace', fontSize: '14px', fontStyle: 'bold',
        color: '#111111', backgroundColor: '#f0c040',
        padding: { x: 20, y: 7 },
      }).setOrigin(0.5).setDepth(20).setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#ffe066', color: '#000' }));
      btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#f0c040', color: '#111111' }));
      btn.on('pointerup', () => this._startGame());
      this.input.keyboard.addKey('ENTER').on('up', () => this._startGame());
      this.input.keyboard.addKey('SPACE').on('up', () => this._startGame());

      // ── Controls panel ────────────────────────────────────────────────
      const cpX = 112, cpY = 112;
      this.add.rectangle(cpX, cpY, 192, 64, 0x000000, 0.52)
        .setStrokeStyle(1, 0x3daa5c, 0.5).setDepth(19);
      const cs = { fontFamily: '"Courier New",monospace', fontSize: '9px', color: '#aaddaa', stroke: '#000', strokeThickness: 2 };
      this.add.text(cpX, cpY - 22, '── CONTROLS ──', { ...cs, color: '#7de8c0' }).setOrigin(0.5).setDepth(20);
      this.add.text(cpX - 84, cpY - 9, 'SPACE  /  TAP ◀', cs).setDepth(20);
      this.add.text(cpX + 30, cpY - 9, '→  JUMP', { ...cs, color: '#f0c040' }).setDepth(20);
      this.add.text(cpX - 84, cpY + 6, 'W / ↑  /  TAP ▶', cs).setDepth(20);
      this.add.text(cpX + 30, cpY + 6, '→  HI-JUMP', { ...cs, color: '#ff8888' }).setDepth(20);
      this.add.text(cpX - 84, cpY + 20, '♥ collect flesh  •  avoid gaps', { ...cs, color: '#cccccc' }).setDepth(20);

      const best = parseInt(localStorage.getItem('zb_best') || '0');
      if (best > 0) {
        this.add.text(W - 18, 20, `BEST ${best}`, {
          fontFamily: '"Courier New",monospace', fontSize: '11px',
          color: '#ffd700', stroke: '#000', strokeThickness: 3,
        }).setOrigin(1, 0).setDepth(20);
      }

      const zb = this.add.image(38, 250, 'zombie')
        .setOrigin(0.5, ZOMBIE_ORIGIN_Y)
        .setScale(ZOMBIE_SCALE * 0.94)
        .setDepth(6);

      // Title pulse
      this.tweens.add({
        targets: title, alpha: 0.75, duration: 1200,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });

      // Button glow pulse
      this.tweens.add({
        targets: btn, scaleX: 1.04, scaleY: 1.04, duration: 700,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });

      if (AUTO_START) {
        this.time.delayedCall(10, () => this._startGame());
      }

      if (d) d.textContent = 'menu:ok';
    } catch (e) {
      if (d) d.textContent = 'menu-err:' + (e.message || String(e)).slice(0, 80);
      console.error('MenuScene.create failed:', e);
    }
  }

  _startGame() {
    if (this.starting) return;
    this.starting = true;
    sessionId = null;
    void apiPost('/sessions', { player_name: playerName }).then((res) => {
      if (res?.session_id) sessionId = res.session_id;
    });
    this.scene.start('GameScene');
  }
}

// ─── GAME SCENE ──────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  create() {
    this.speed = INIT_SPD;
    this.score = 0;
    this.dist = 0;
    this.flesh = 0;
    this.level = 0;
    this.over = false;
    this.jumpsUsed = 0;
    this.coyote = 0;
    this.platforms = [];
    // nextX = current screen x of right edge of last generated platform
    // decreases each frame as the world scrolls
    this.nextX = 0;
    this.prevY = GROUND_Y;
    this.inputLockedUntil = 0;
    this.inputReady = false;
    this.lastLandKey = 'land4';
    this.prevNormalKeyDown = [];
    this.prevHighKeyDown = [];
    this.prevPointerDown = false;
    this.prevPointerX = 0;
    this.traceJumpCalls = 0;
    this.diagEl = TRACE_UI ? document.getElementById('diag') : null;
    if (this.diagEl) {
      this.diagEl.style.display = 'block';
      this.diagEl.style.whiteSpace = 'pre';
    }

    addBackground(this);
    this.physics.world.gravity.y = GRAVITY;

    // ── Platform group: DYNAMIC bodies, immovable, no gravity ─────────────
    // Dynamic bodies (unlike static) update their spatial tree automatically
    // when their position changes, so collision detection is always correct.
    this.platGroup = this.physics.add.group();

    // Starting platform — cliff-like start ledge
    const startPlat = this._spawn(0, GROUND_Y, 280, true);
    this.nextX = startPlat.leftX + startPlat.width;
    for (let i = 0; i < 7; i++) this._gen();

    this.zombie = this.physics.add.sprite(PLAYER_X, GROUND_Y, 'zombie');
    this.zombie
      .setOrigin(0.5, ZOMBIE_ORIGIN_Y)
      .setCollideWorldBounds(false)
      .setScale(ZOMBIE_SCALE)
      .setDepth(5);
    this.zombie.body
      .setSize(ZOMBIE_BODY_W, ZOMBIE_BODY_H, false)
      .setOffset(ZOMBIE_BODY_OFF_X, ZOMBIE_BODY_OFF_Y);

    // ── Collider: only resolve when zombie is moving downward (landing) ───
    // This prevents side-on hits from platforms scrolling under the zombie
    // from pushing it sideways and triggering a false game-over.
    this.physics.add.collider(
      this.zombie, this.platGroup,
      (_zb, plat) => this._onLand(plat),
      (_zb, plat) => this._isLandingOnTop(plat),
      this
    );

    // Input — normal jump: SPACE  |  high jump: W or UP arrow
    if (JUMP_ENABLED) {
      this.normalKeys = [this.input.keyboard.addKey('SPACE')];
      this.highKeys   = [this.input.keyboard.addKey('W'), this.input.keyboard.addKey('UP')];
    } else {
      this.normalKeys = [];
      this.highKeys   = [];
    }
    this.prevNormalKeyDown = this.normalKeys.map((k) => k.isDown);
    this.prevHighKeyDown   = this.highKeys.map((k) => k.isDown);
    this.prevPointerDown = this.input.activePointer.isDown;
    this.inputLockedUntil = this.time.now + INPUT_GRACE_MS;

    // ── On-screen jump buttons ────────────────────────────────────────────
    const btnY = H - 20;
    const bStyle = { fontFamily: '"Courier New",monospace', fontSize: '10px', fontStyle: 'bold',
      color: '#111', stroke: '#000', strokeThickness: 1 };

    // Normal-jump button (left side)
    const nbg = this.add.rectangle(70, btnY, 124, 32, 0x000000, 0.50)
      .setStrokeStyle(1.5, 0x4dba88, 0.8).setDepth(12).setInteractive();
    this.add.text(70, btnY - 5, 'JUMP', { ...bStyle, fontSize: '11px', color: '#f0c040' })
      .setOrigin(0.5).setDepth(13);
    this.add.text(70, btnY + 7, 'SPACE  /  TAP ◀', { ...bStyle, color: '#aaffaa' })
      .setOrigin(0.5).setDepth(13);
    nbg.on('pointerdown', () => this._jump(false));

    // High-jump button (right side)
    const hbg = this.add.rectangle(W - 70, btnY, 124, 32, 0x000000, 0.50)
      .setStrokeStyle(1.5, 0xff4444, 0.8).setDepth(12).setInteractive();
    this.add.text(W - 70, btnY - 5, 'HI-JUMP', { ...bStyle, fontSize: '11px', color: '#ff8888' })
      .setOrigin(0.5).setDepth(13);
    this.add.text(W - 70, btnY + 7, 'W / ↑  /  TAP ▶', { ...bStyle, color: '#ffaaaa' })
      .setOrigin(0.5).setDepth(13);
    hbg.on('pointerdown', () => this._jump(true));

    // ── Game-start tutorial overlay (fades out after 2.2 s) ──────────────
    const tutBg = this.add.rectangle(W / 2, H / 2, 340, 90, 0x000000, 0.72)
      .setStrokeStyle(2, 0x7de8c0, 0.7).setDepth(25);
    const ts = { fontFamily: '"Courier New",monospace', stroke: '#000', strokeThickness: 3 };
    const tut0 = this.add.text(W / 2, H / 2 - 28, '── CONTROLS ──',
      { ...ts, fontSize: '11px', color: '#7de8c0' }).setOrigin(0.5).setDepth(26);
    const tut1 = this.add.text(W / 2, H / 2 - 10, 'SPACE / TAP ◀    →   JUMP',
      { ...ts, fontSize: '11px', color: '#f0c040' }).setOrigin(0.5).setDepth(26);
    const tut2 = this.add.text(W / 2, H / 2 + 8,  'W / ↑ / TAP ▶    →   HI-JUMP',
      { ...ts, fontSize: '11px', color: '#ff8888' }).setOrigin(0.5).setDepth(26);
    const tut3 = this.add.text(W / 2, H / 2 + 26, 'Collect ♥ meat  •  Avoid the gaps!',
      { ...ts, fontSize: '9px', color: '#cccccc' }).setOrigin(0.5).setDepth(26);
    const tutObjs = [tutBg, tut0, tut1, tut2, tut3];
    this.time.delayedCall(1800, () => {
      this.tweens.add({ targets: tutObjs, alpha: 0, duration: 500,
        onComplete: () => tutObjs.forEach((o) => o.destroy()) });
    });

    // Difficulty ramp within each level
    this.diffTimer = this.time.addEvent({
      delay: DIFF_MS, loop: true,
      callback: () => {
        if (!this.over) { this.speed = Math.min(this.speed + SPD_STEP, MAX_SPD); Sfx.speedUp(); }
      },
    });

    // Periodic score sync
    this.time.addEvent({
      delay: 2000, loop: true,
      callback: () => {
        if (sessionId && !this.over)
          apiPost(`/sessions/${sessionId}/score`, { score: this.score, distance: Math.floor(this.dist) });
      },
    });

    // HUD
    const hs = {
      fontFamily: '"Courier New",monospace', fontSize: '11px',
      color: '#f0c040', stroke: '#000000', strokeThickness: 3
    };
    this.add.rectangle(W / 2, 15, W, 30, 0x000000, 0.65).setDepth(10);
    // Accent line under HUD bar
    this.add.rectangle(W / 2, 29, W, 2, 0x4dba88, 1).setDepth(10);

    this.scoreTxt = this.add.text(12, 4, 'SCORE  0', hs).setDepth(11);
    this.fleshTxt = this.add.text(152, 4, '\u2665 0',
      { ...hs, color: '#ff4444' }).setDepth(11);
    this.bestTxt = this.add.text(W / 2, 4,
      'BEST  ' + (localStorage.getItem('zb_best') || '0'), hs)
      .setOrigin(0.5, 0).setDepth(11);
    this.levelTxt = this.add.text(W - 12, 4, 'LVL 1  GRAVEYARD',
      { ...hs, color: '#7de8c0' }).setOrigin(1, 0).setDepth(11);

  }

  _chooseFillDepth(topY, isStart, landKey) {
    if (isStart) return H - topY - 10;
    if (topY > H * 0.63) return Phaser.Math.Between(88, 154);
    if (topY > H * 0.48) return Phaser.Math.Between(54, 108);
    if (landKey) return Phaser.Math.Between(18, 44);
    return Phaser.Math.Between(0, 24);
  }

  _buildPathFlesh(leftX, topY, width, isStart) {
    const fleshArr = [];
    if (isStart || width < 100) return fleshArr;

    const count = Phaser.Math.Clamp(Math.round(width / 72), 2, 5);
    const startX = Math.min(FLESH_PATH_INSET, width / 2);
    const endX = Math.max(width - FLESH_PATH_INSET, width / 2);

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const rx = Math.round(Phaser.Math.Linear(startX, endX, t));
      const baseY = topY - FLESH_HOVER;
      const sprite = this.add.image(leftX + rx, baseY, 'flesh').setDepth(6);
      fleshArr.push({ sprite, rx, baseY, phase: 0, collected: false });
    }

    return fleshArr;
  }

  // ─── Spawn one platform ─────────────────────────────────────────────────
  _spawn(leftX, topY, width, isStart = false, landKey = null) {
    if (!isStart && !landKey && this.textures.exists('land1')) {
      landKey = (this.lastLandKey === 'land1' && this.textures.exists('land4')) ? 'land4' : 'land1';
    }
    if (landKey && LAND_CFGS[landKey]) width = LAND_CFGS[landKey].rw;

    const fillDepth = this._chooseFillDepth(topY, isStart, landKey);
    const chunk = createChunkVisual(this, { leftX, topY, width, landKey, fillDepth, depth: 4 });
    const ts = chunk.top;

    // Physics body: dynamic, immovable, no gravity.
    // Arcade body.reset(x, y) uses top-left coordinates, so keep the
    // invisible carrier aligned to the platform's logical left/top.
    const go = this.platGroup.create(leftX, topY, null);
    go.setOrigin(0, 0);
    go.setVisible(false);
    go.body.allowGravity = false;
    go.body.immovable = true;
    go.body.setSize(width, PLAT_H, false);
    go.body.reset(leftX, topY);

    const fleshArr = this._buildPathFlesh(leftX, topY, width, isStart);

    const plat = { leftX, topY, width, ts, go, decor: [], flesh: fleshArr, visuals: chunk.visuals };
    this.platforms.push(plat);
    if (!isStart && width >= 80) this._addDecor(plat);
    return plat;
  }

  _addDecor(plat) {
    const pool = ['skull', 'skull', 'crate', 'tombstone', 'bone', 'bone', 'sign', 'bush'];
    const count = Phaser.Math.Between(0, Math.min(2, Math.ceil(plat.width / 90)));
    const slots = new Set();
    for (let i = 0; i < count; i++) {
      let rx, t = 0;
      do { rx = Phaser.Math.Between(16, plat.width - 16); t++; }
      while (slots.has(Math.floor(rx / 40)) && t < 10);
      slots.add(Math.floor(rx / 40));
      const sp = this.add.image(plat.leftX + rx, plat.topY - 2,
        Phaser.Utils.Array.GetRandom(pool)).setOrigin(0.5, 1).setDepth(4.5);
      plat.decor.push({ sprite: sp, rx });
    }
  }

  // ─── Procedural generation ───────────────────────────────────────────────
  _gen() {
    const earlyGame = this.dist < 1800;
    const maxGap = this.speed * AIR_TIME * 0.6;
    const maxEarlyGap = Math.max(GAP_MIN + 8, Math.min(maxGap * 0.78, 110));
    const maxLateGap = Math.max(GAP_MIN + 20, Math.min(maxGap * 0.95, 180));
    const gap = CONTINUOUS_GROUND
      ? 0
      : Phaser.Math.Between(
        GAP_MIN,
        earlyGame ? maxEarlyGap : maxLateGap
      );

    // Prefer the supplied land-element art for almost all floating platforms.
    let width, landKey = null;
    const landKeys = ['land1', 'land4'].filter(k => this.textures.exists(k));
    if (landKeys.length) {
      landKey = landKeys.find((k) => k !== this.lastLandKey) || landKeys[0];
      if (!earlyGame && landKeys.length > 1 && Math.random() < 0.35) {
        landKey = Phaser.Utils.Array.GetRandom(landKeys);
      }
      this.lastLandKey = landKey;
      width = LAND_CFGS[landKey].rw;
    } else {
      width = Phaser.Math.Between(
        earlyGame ? 190 : 110,
        earlyGame ? 280 : 240
      );
    }

    const maxClimb = Math.min(110, ((JUMP_VEL * JUMP_VEL) / (2 * GRAVITY)) - 40);
    const newY = FLAT_PLATFORM_PATH
      ? GROUND_Y
      : Phaser.Math.Clamp(
        this.prevY + Phaser.Math.Between(-90, maxClimb),
        H * 0.25, GROUND_Y
      );
    const leftX = this.nextX + gap;
    this._spawn(leftX, newY, width, false, landKey);
    this.nextX = leftX + width;
    this.prevY = newY;
  }

  // ─── Jump (high=false → normal, high=true → super) ───────────────────────
  _jump(high = false) {
    this.traceJumpCalls++;
    if (this.over || !JUMP_ENABLED) return;
    if (!this.inputReady) return;
    if (this.time.now < this.inputLockedUntil) return;
    if (this.jumpsUsed < 1 && (this._isGrounded() || this.coyote > 0)) {
      this.zombie.body.setVelocityY(high ? JUMP_VEL_HIGH : JUMP_VEL);
      this.jumpsUsed++;
      this.coyote = 0;
      high ? Sfx.jumpHigh() : Sfx.jump();
    }
  }

  _isGrounded() {
    const body = this.zombie.body;
    return body.blocked.down || body.touching.down;
  }

  _isLandingOnTop(plat) {
    const body = this.zombie.body;
    const platBody = plat.body;
    const prevBottom = body.prev.y + body.height;
    const overlapX = body.right > platBody.left + 4 && body.left < platBody.right - 4;
    const comingFromAbove = prevBottom <= platBody.top + LANDING_TOL;
    return overlapX && comingFromAbove && body.velocity.y >= 0;
  }

  _onLand(_plat) {
    if (this.jumpsUsed > 0) Sfx.land();
    this.jumpsUsed = 0;
  }

  // ─── Flesh collected ─────────────────────────────────────────────────────
  _collectFlesh(item, cx, cy) {
    item.collected = true;
    item.sprite.destroy();
    this.flesh++;
    this.fleshTxt.setText('\u2665 ' + this.flesh);

    const popup = this.add.text(cx, cy - 8, `+${FLESH_VAL}`, {
      fontFamily: '"Courier New",monospace', fontSize: '13px', color: '#ff6644',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(20);
    this.tweens.add({
      targets: popup, y: cy - 34, alpha: 0, duration: 580, ease: 'Cubic.easeOut',
      onComplete: () => popup.destroy()
    });

    this.zombie.setTint(0xff3300);
    this.time.delayedCall(90, () => this.zombie.clearTint());
  }

  // ─── Update ──────────────────────────────────────────────────────────────
  update(_, delta) {
    if (this.over) return;
    const dt = Math.min(delta, MAX_FRAME_MS) / 1000;
    const now = this.time.now;

    this.zombie.setScale(ZOMBIE_SCALE);
    this.zombie.setAngle(0);

    // ── Normal-jump keys (SPACE) ──────────────────────────────────────────
    const normalStates = this.normalKeys.map((k) => k.isDown);
    const normalPressed = normalStates.some((d, i) => d && !this.prevNormalKeyDown[i]);
    this.prevNormalKeyDown = normalStates;

    // ── High-jump keys (W / UP) ───────────────────────────────────────────
    const highStates = this.highKeys.map((k) => k.isDown);
    const highPressed = highStates.some((d, i) => d && !this.prevHighKeyDown[i]);
    this.prevHighKeyDown = highStates;

    const holdingAnyKey = normalStates.some(Boolean) || highStates.some(Boolean);

    // ── Pointer — left half = normal jump, right half = high jump ─────────
    const ptr = this.input.activePointer;
    const ptrJustDown = ptr.isDown && !this.prevPointerDown;
    this.prevPointerDown = ptr.isDown;
    const ptrNormal = ptrJustDown && ptr.x <= W / 2;
    const ptrHigh   = ptrJustDown && ptr.x >  W / 2;

    if (!this.inputReady) {
      if (now >= this.inputLockedUntil && !holdingAnyKey && !ptr.isDown) {
        this.inputReady = true;
      }
    }

    if (this.inputReady && now >= this.inputLockedUntil) {
      if (normalPressed || ptrNormal) this._jump(false);
      else if (highPressed || ptrHigh) this._jump(true);
    }

    // Scroll platforms
    const dx = this.speed * dt;  // pixels to move left this frame

    for (let i = this.platforms.length - 1; i >= 0; i--) {
      const p = this.platforms[i];
      p.leftX -= dx;

      // ── Move dynamic physics body ──────────────────────────────────────
      // body.reset(x, y) expects top-left coordinates.
      p.go.x = p.leftX;
      p.go.y = p.topY;
      p.go.body.reset(p.leftX, p.topY);

      // ── Move visual chunk ──────────────────────────────────────────────
      for (const v of p.visuals) v.sprite.x = p.leftX + v.offsetX;

      // ── Decor ─────────────────────────────────────────────────────────
      for (const d of p.decor) d.sprite.x = p.leftX + d.rx;

      // ── Flesh: move + collect ─────────────────────────────────────────
      for (const item of p.flesh) {
        if (item.collected) continue;
        const cx = p.leftX + item.rx;
        const cy = item.baseY + (FLESH_BOB ? Math.sin(now * FLESH_SPEED + item.phase) * FLESH_BOB : 0);
        item.sprite.x = cx;
        item.sprite.y = cy;

        const ddx = cx - this.zombie.body.center.x;
        const ddy = cy - this.zombie.body.center.y;
        if (ddx * ddx + ddy * ddy < FLESH_R2) {
          Sfx.flesh();
          this._collectFlesh(item, cx, cy);
        }
      }

      // Cull off-screen
      if (p.leftX + p.width < -160) {
        p.go.destroy();
        for (const v of p.visuals) v.sprite.destroy();
        for (const d of p.decor) d.sprite.destroy();
        for (const f of p.flesh) if (!f.collected) f.sprite.destroy();
        this.platforms.splice(i, 1);
      }
    }

    // ── Infinite generation ───────────────────────────────────────────────
    // nextX scrolls left with the world; generate whenever the frontier
    // is less than 700px beyond the right edge of the screen.
    this.nextX -= dx;
    while (this.nextX < W + 360) this._gen();

    const grounded = this.zombie.body.blocked.down || this.zombie.body.touching.down;
    if (grounded) {
      this.coyote = 120;
    } else if (this.coyote > 0) {
      this.coyote -= delta;
    }

    // ── Score ─────────────────────────────────────────────────────────────
    this.dist += this.speed * dt;
    this.score = Math.floor(this.dist / 8) + this.flesh * FLESH_VAL;
    this.scoreTxt.setText('SCORE  ' + this.score);
    const best = parseInt(localStorage.getItem('zb_best') || '0');
    if (this.score > best) {
      localStorage.setItem('zb_best', this.score);
      this.bestTxt.setText('BEST  ' + this.score);
    }

    // ── Level check ───────────────────────────────────────────────────────
    this._checkLevel();

    // Die only when fallen into a gap (below screen)
    if (this.zombie.body.top > H + 100) this._die();

    if (this.diagEl) {
      this.diagEl.textContent =
        'game:trace' +
        '\ny=' + this.zombie.y.toFixed(2) +
        ' vy=' + this.zombie.body.velocity.y.toFixed(2) +
        '\nblocked.down=' + this.zombie.body.blocked.down +
        '\njumpCalls=' + this.traceJumpCalls +
        '\nready=' + this.inputReady;
    }
  }

  async _die() {
    if (this.over) return;
    this.over = true;
    this.diffTimer.remove();
    if (sessionId) {
      void apiPost(`/sessions/${sessionId}/end`, {
        score: this.score,
        distance: Math.floor(this.dist),
      });
    }
    Sfx.die();
    this.cameras.main.shake(300, 0.014);
    this.time.delayedCall(520, () =>
      this.scene.start('GameOverScene', { score: this.score, distance: Math.floor(this.dist), flesh: this.flesh, level: this.level })
    );
  }

  // ─── Level advance ───────────────────────────────────────────────────────
  _checkLevel() {
    const next = LEVELS[this.level + 1];
    if (!next || this.dist < next.minDist) return;

    this.level++;
    this.speed = Math.max(this.speed, next.baseSpd);
    Sfx.levelUp();

    // Banner overlay
    const bannerY = H / 2 - 20;
    const lvlNum = this.add.text(W / 2, bannerY - 22, `LEVEL ${this.level + 1}`, {
      fontFamily: '"Courier New",monospace', fontSize: '18px', fontStyle: 'bold',
      color: '#ff4444', stroke: '#000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(30).setAlpha(0);
    const lvlName = this.add.text(W / 2, bannerY + 8, next.name, {
      fontFamily: '"Courier New",monospace', fontSize: '28px', fontStyle: 'bold',
      color: '#ffffff', stroke: '#220000', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(30).setAlpha(0);

    this.tweens.add({
      targets: [lvlNum, lvlName],
      alpha: { from: 0, to: 1 }, y: `-=12`,
      duration: 280, ease: 'Cubic.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: [lvlNum, lvlName],
          alpha: 0, delay: 1100, duration: 400,
          onComplete: () => { lvlNum.destroy(); lvlName.destroy(); },
        });
      },
    });

    this.levelTxt.setText(`LVL ${this.level + 1}  ${next.name}`);
  }
}

// ─── GAME OVER SCENE ─────────────────────────────────────────────────────────
class GameOverScene extends Phaser.Scene {
  constructor() { super({ key: 'GameOverScene' }); }
  init(d) { this.finalScore = d.score || 0; this.finalDist = d.distance || 0; this.finalFlesh = d.flesh || 0; this.finalLevel = d.level || 0; }

  async create() {
    addBackground(this);
    if (TRACE_UI) {
      const d = document.getElementById('diag');
      if (d) {
        d.style.display = 'block';
        d.style.whiteSpace = 'pre';
        d.textContent = `gameover\nscore=${this.finalScore}\ndistance=${this.finalDist}`;
      }
    }
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55);

    let go;
    if (this.textures.exists('gameOverImg')) {
      const s = OVERLAY_WORDMARK_W / 2104;
      go = this.add.image(W / 2, H / 2 - 92, 'gameOverImg').setOrigin(0.5).setScale(s);
      this.tweens.add({ targets: go, scaleX: { from: s * 0.08, to: s }, scaleY: { from: s * 0.08, to: s }, duration: 460, ease: 'Back.easeOut' });
    } else {
      go = this.add.text(W / 2, H / 2 - 92, 'GAME OVER', {
        fontFamily: '"Courier New",monospace', fontSize: '36px', fontStyle: 'bold',
        color: '#f0a024', stroke: '#ffffff', strokeThickness: 8,
        shadow: { offsetX: 5, offsetY: 5, color: '#7a3600', fill: true },
      }).setOrigin(0.5);
      this.tweens.add({ targets: go, scaleX: { from: 0.08, to: 1 }, scaleY: { from: 0.08, to: 1 }, duration: 460, ease: 'Back.easeOut' });
    }

    this.add.text(W / 2, H / 2 + 4, `Score: ${this.finalScore}`,
      { fontFamily: '"Courier New",monospace', fontSize: '26px', color: '#f0c040' }).setOrigin(0.5);
    this.add.text(W / 2, H / 2 + 34, `Distance: ${this.finalDist} m  |  Level ${this.finalLevel + 1}`,
      { fontFamily: '"Courier New",monospace', fontSize: '14px', color: '#d0c8a8' }).setOrigin(0.5);
    this.add.text(W / 2, H / 2 + 56, `\u2665 Flesh eaten: ${this.finalFlesh}`,
      { fontFamily: '"Courier New",monospace', fontSize: '15px', color: '#ff6644' }).setOrigin(0.5);

    const lb = await apiGet('/leaderboard');
    if (lb?.scores?.length) {
      this.add.text(W / 2, H / 2 + 78, '─── TOP SCORES ───',
        { fontFamily: '"Courier New",monospace', fontSize: '11px', color: '#555' }).setOrigin(0.5);
      lb.scores.slice(0, 4).forEach((s, i) => {
        this.add.text(W / 2, H / 2 + 94 + i * 18, `${i + 1}.  ${s.player_name}   ${s.score}`, {
          fontFamily: '"Courier New",monospace', fontSize: '12px',
          color: i === 0 ? '#f0c040' : '#b8b098',
        }).setOrigin(0.5);
      });
    }

    const hint = this.add.text(W / 2, H - 22, 'SPACE  /  TAP  to restart',
      { fontFamily: '"Courier New",monospace', fontSize: '12px', color: '#555' }).setOrigin(0.5);
    this.tweens.add({ targets: hint, alpha: 0, duration: 720, yoyo: true, repeat: -1 });

    let restarting = false;
    const restart = () => {
      if (restarting) return;
      restarting = true;
      sessionId = null;
      void apiPost('/sessions', { player_name: playerName }).then((res) => {
        if (res?.session_id) sessionId = res.session_id;
      });
      this.scene.start('GameScene');
    };
    this.input.keyboard.once('keyup-SPACE', restart);
    this.input.keyboard.once('keyup-ENTER', restart);
    this.input.once('pointerup', restart);
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
let phaserGame = null;

window.initZombieGame = function () {
  if (phaserGame) { phaserGame.destroy(true); phaserGame = null; }

  var d = document.getElementById('diag');
  if (d) d.textContent = 'init:start';
  // BootScene loads the embedded data-URI assets directly, which avoids
  // the file:// startup stall seen with the manual image-prepare path.

  phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#03040b',
    pixelArt: true,
    render: {
      antialias: false,
      pixelArt: true,
      roundPixels: true,
      powerPreference: 'high-performance',
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: W, height: H,
      min: { width: 320, height: 157 },
      max: { width: 1920, height: 940 },
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { y: 0 }, debug: false },
    },
    scene: [BootScene, MenuScene, GameScene, GameOverScene],
  });

  // Probe: show when Phaser has fully booted (fires asynchronously)
  phaserGame.events.once('ready', function () {
    var d = document.getElementById('diag');
    if (d && !/^menu:|^game:|^boot:/.test(d.textContent)) d.textContent = 'phaser ready';
  });
};
