/**
 * Zombie Hop  –  v5
 *
 * Root-cause fixes:
 *  1. Platforms use DYNAMIC bodies (allowGravity:false, immovable:true).
 *     Static bodies don't update their spatial tree when repositioned
 *     manually, causing missed collisions ("falling through land").
 *  2. Platform visuals use tileSprite – no tile overflow into gaps.
 *  3. Infinite generation fixed: nextX scrolls with the world each frame.
 *  4. Collider process callback: only top-surface landings count.
 *  5. Coin system: gold coins float above platforms, +10 score each.
 *  6. Zombie sprite uses a foot-line origin + landing snap so it rests on
 *     the platform surface instead of visually sinking into the dirt.
 */

// ─── LOGICAL RESOLUTION ───────────────────────────────────────────────────────
const W = 860, H = 420;

// ─── PHYSICS ─────────────────────────────────────────────────────────────────
const GRAVITY  = 1500;
const JUMP_VEL = -760;
const AIR_TIME = (2 * 760) / 1500;  // ≈ 1.013 s
const JUMP_ENABLED = true;
const CONTINUOUS_GROUND = false;
const FLAT_PLATFORM_PATH = true;

// ─── SPEED / DIFFICULTY ──────────────────────────────────────────────────────
const INIT_SPD = 190;
const MAX_SPD  = 420;
const SPD_STEP = 12;
const DIFF_MS  = 6500;

// ─── LAYOUT ──────────────────────────────────────────────────────────────────
const PLAYER_X = 130;
const TILE_W   = 200;
const CAP_H    = 14;
const DIRT_H   = 44;
const PLAT_H   = CAP_H + DIRT_H;        // 58 px total
const GAP_MIN  = 68;
const GROUND_Y = Math.round(H * 0.73);  // ≈ 307
const INPUT_GRACE_MS = 260;
const MAX_FRAME_MS   = 34;
const OVERLAY_WORDMARK_W = 420;

// ─── LAND ELEMENT SPRITES ────────────────────────────────────────────────────
// Each entry: image size (iw×ih) and the Y-fraction where the grass cap starts.
// At LAND_SCALE, rw = rendered width used for physics body width.
const LAND_SCALE = 0.2;
const LAND_CFGS = {
  land1: { iw:1508, ih:608, capFrac:145/608 },   // floating platform w/ sign/tombstone/tree
  land4: { iw:1613, ih:666, capFrac:165/666 },   // floating platform w/ sign/skull/bush
};
Object.values(LAND_CFGS).forEach(c => {
  c.rw = Math.round(c.iw * LAND_SCALE);
  c.rh = Math.round(c.ih * LAND_SCALE);
});

// ─── COINS ───────────────────────────────────────────────────────────────────
const COIN_VAL    = 10;
const COIN_HOVER  = 10;   // keep coins in the running path
const COIN_BOB    = 0;
const COIN_SPEED  = 0.003;
const COIN_R2     = 18 * 18; // squared collection radius
const COIN_PATH_INSET = 34;

// ─── PALETTE ─────────────────────────────────────────────────────────────────
const C = {
  skyTop:0x03040b, skyBot:0x0a1422,
  moonW: 0xf6ffff, moonM: 0xd0e8f8, moonG: 0xa8c8e8,
  hFar:  0x071018, hNr:   0x0a1624,
  // Platform: bright teal grass cap + warm brown dirt
  capT:  0x7de8c0, capB:  0x4dba88, capR:  0x2e8c60,
  drtB:  0x8b5e2d, drtD:  0x5c3412, drtL:  0xb07840,
  skin:  0x70b070, shDk:  0x2d4828, shLt:  0x3c5c38,
  pant:  0x223022, shoe:  0x160d05, brai:  0xc03020,
  wht:   0xffffff, red:   0xff2020,
  // Decorations: more saturated for visibility
  skul:  0xf0e6c0, crWd:  0xa06828, crX:   0xe04020,
  tomb:  0x8899aa, bone:  0xe8ddb8,
  sgnB:  0x8b5c28, sgnP:  0xa07040,
  bshG:  0x3daa5c, bshL:  0x5dd878,
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
  function tone({ type='square', freq=440, freq2=freq, gain=0.18, duration=0.12, attack=0.004, decay=0.08 }) {
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
      tone({ type:'square', freq:260, freq2:520, gain:0.14, duration:0.12, attack:0.005, decay:0.10 });
    },

    land() {
      // Soft thud – low sine blip
      tone({ type:'sine', freq:130, freq2:80, gain:0.20, duration:0.06, attack:0.002, decay:0.05 });
    },

    coin() {
      // Two-note chime: first note then a brighter one
      tone({ type:'sine', freq:880, freq2:880, gain:0.16, duration:0.08, attack:0.003, decay:0.07 });
      tone({ type:'sine', freq:1320, freq2:1320, gain:0.12, duration:0.08, attack:0.05, decay:0.08 });
    },

    die() {
      // Descending buzzy sweep
      tone({ type:'sawtooth', freq:400, freq2:80, gain:0.22, duration:0.45, attack:0.005, decay:0.42 });
    },

    speedUp() {
      // Quick ascending blip for difficulty ramp
      tone({ type:'sine', freq:600, freq2:900, gain:0.10, duration:0.10, attack:0.003, decay:0.09 });
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
      method:'POST', headers:{'Content-Type':'application/json'},
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
    bg:          [uri('ASSET_BG'),       resolveAssetPath('background.png')  ].filter(Boolean),
    zombie:      [uri('ASSET_ZOMBIE'),   resolveAssetPath('Zombie.png')      ].filter(Boolean),
    land1:       [uri('ASSET_LAND1'),    resolveAssetPath('landElement1.png')].filter(Boolean),
    land4:       [uri('ASSET_LAND4'),    resolveAssetPath('landElement4.png')].filter(Boolean),
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
        loadImageWithFallback('zombie',     sources.zombie),
      ]);

      // Optional assets – null on failure (game degrades gracefully)
      const optKeys = ['land1', 'land4', 'getReadyImg', 'gameOverImg'];
      const settled  = await Promise.allSettled(
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
  const g = scene.add.graphics({ x:0, y:0 });

  /* PLATFORM TILE  200 × 58 */
  g.clear();
  g.fillStyle(C.capB);       g.fillRect(0, 0, TILE_W, CAP_H);
  g.fillStyle(C.capT, 0.85); g.fillRect(0, 0, TILE_W, 5);
  g.fillStyle(C.capR, 0.60); g.fillRect(0, CAP_H - 3, TILE_W, 3);
  g.fillStyle(C.drtB);       g.fillRect(0, CAP_H, TILE_W, DIRT_H);
  g.fillStyle(C.drtD);
  [[10,5,14,10],[35,14,13,9],[62,4,16,10],[90,9,13,9],[116,4,15,10],
   [142,13,13,9],[168,4,14,10],[20,20,14,9],[52,19,16,10],[82,22,13,8],
   [110,19,15,9],[140,18,13,8],[165,22,12,8],[28,32,13,8],[58,28,15,9],
   [90,32,14,9],[120,29,13,8],[153,27,12,8],[185,18,13,9]]
    .forEach(([x,y,w,h]) => g.fillEllipse(x, CAP_H + y, w, h));
  g.fillStyle(C.drtL);
  [[24,8,7,5],[55,17,6,4],[87,6,5,4],[114,15,7,4],[146,9,7,5],[178,20,5,4]]
    .forEach(([x,y,w,h]) => g.fillEllipse(x, CAP_H + y, w, h));
  g.generateTexture('platform', TILE_W, PLAT_H);

  /* SKULL  30 × 24 */
  g.clear();
  g.fillStyle(C.skul);
  g.fillEllipse(15,11,28,20); g.fillRect(9,15,12,9);
  g.fillStyle(C.drtD);
  g.fillEllipse(10,11,8,9); g.fillEllipse(20,11,8,9);
  g.fillRect(9,20,3,5); g.fillRect(13,20,3,5); g.fillRect(17,20,3,5);
  g.generateTexture('skull', 30, 24);

  /* CRATE  36 × 36 */
  g.clear();
  g.fillStyle(C.crWd); g.fillRect(1,1,34,34);
  g.fillStyle(0xffffff,0.12); g.fillRect(1,1,34,5);
  g.fillStyle(0x000000,0.25);
  g.fillRect(0,0,36,2); g.fillRect(0,34,36,2);
  g.fillRect(0,0,2,36); g.fillRect(34,0,2,36);
  g.fillStyle(0x000000,0.15); g.fillRect(0,17,36,2); g.fillRect(17,0,2,36);
  g.fillStyle(C.crX);
  for (let i=0;i<10;i++){g.fillRect(4+i*3,4+i*3,3,3); g.fillRect(28-i*3,4+i*3,3,3);}
  g.generateTexture('crate', 36, 36);

  /* TOMBSTONE  24 × 36 */
  g.clear();
  g.fillStyle(C.tomb);
  g.fillRect(6,16,12,20); g.fillEllipse(12,16,18,24);
  g.fillStyle(0x96a5a6); g.fillRect(9,18,6,2); g.fillRect(11,15,2,6);
  g.fillStyle(0x5d6d6e); g.fillRect(6,16,3,20);
  g.generateTexture('tombstone', 24, 36);

  /* BONE  26 × 10 */
  g.clear();
  g.fillStyle(C.bone);
  g.fillEllipse(5,5,10,10); g.fillEllipse(21,5,10,10); g.fillRect(5,2,16,6);
  g.generateTexture('bone', 26, 10);

  /* SIGN  28 × 42 */
  g.clear();
  g.fillStyle(C.sgnP); g.fillRect(11,0,5,42);
  g.fillStyle(C.sgnB); g.fillRect(0,9,28,22);
  g.fillStyle(0xffffff,0.1); g.fillRect(0,9,28,4);
  g.fillStyle(0x5a3818,0.35);
  g.fillRect(0,15,28,1); g.fillRect(0,21,28,1); g.fillRect(0,27,28,1);
  g.generateTexture('sign', 28, 42);

  /* BUSH  40 × 26 */
  g.clear();
  g.fillStyle(C.bshG);
  g.fillEllipse(12,18,22,20); g.fillEllipse(28,17,22,20); g.fillEllipse(20,12,26,22);
  g.fillStyle(C.bshL,0.55); g.fillEllipse(14,9,16,14); g.fillEllipse(24,10,14,12);
  g.generateTexture('bush', 40, 26);

  /* DEAD TREE  54 × 120 */
  g.clear();
  g.fillStyle(C.treeC);
  g.fillRect(24,28,8,92); g.fillRect(10,52,16,6); g.fillRect(10,42,6,16);
  g.fillRect(4,38,8,5);   g.fillRect(30,44,20,6); g.fillRect(44,30,6,22);
  g.fillRect(44,26,10,5); g.fillRect(18,60,8,5);  g.fillRect(32,58,12,5);
  g.fillRect(21,34,5,18); g.fillRect(30,30,5,20);
  g.generateTexture('tree', 54, 120);

  /* COIN  20 × 20 */
  g.clear();
  g.fillStyle(0xb8860b); g.fillCircle(10,10,10);    // rim
  g.fillStyle(0xffd700); g.fillCircle(10,10,8);     // face
  g.fillStyle(0xffe566); g.fillEllipse(7,7,7,5);    // shine
  g.fillStyle(0xb8860b);                              // $ mark
  g.fillRect(9,3,2,14); g.fillRect(5,7,10,2); g.fillRect(5,11,10,2);
  g.generateTexture('coin', 20, 20);

  /* TERRAIN FILL  96 × 96 */
  g.clear();
  g.fillStyle(0x6f4526); g.fillRect(0, 0, 96, 96);
  g.fillStyle(0x4a2710, 0.95);
  [[8,10,18,8],[28,20,14,9],[55,13,17,10],[74,26,15,10],[18,42,13,8],
   [42,36,18,11],[70,48,20,12],[10,68,17,10],[34,72,14,9],[58,66,16,10],[80,78,13,8]]
    .forEach(([x,y,w,h]) => g.fillEllipse(x, y, w, h));
  g.fillStyle(0x8c5a37, 0.9);
  [[14,24,8,5],[37,11,7,5],[63,31,8,5],[81,16,7,5],[24,56,8,5],[52,51,7,5],[76,60,8,5]]
    .forEach(([x,y,w,h]) => g.fillEllipse(x, y, w, h));
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
    top = scene.add.image(leftX, topY, landKey)
      .setOrigin(0, cfg.capFrac)
      .setScale(LAND_SCALE)
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
  scene.add.image(W / 2, H / 2, 'bg').setDisplaySize(W, H);
}

// ─── ZOMBIE SPRITE SCALE ─────────────────────────────────────────────────────
// Zombie.png is 496×576 px. The lowest visible foot pixel is at y=507,
// so we anchor the sprite on that foot line instead of the transparent
// bottom of the frame. This keeps the feet visually on the platform top.
const ZOMBIE_SCALE = 0.145;
const ZOMBIE_W = 496;
const ZOMBIE_H = 576;
const ZOMBIE_FOOT_Y = 508;
const ZOMBIE_ORIGIN_Y = ZOMBIE_FOOT_Y / ZOMBIE_H;
const ZOMBIE_BODY_W = 36;
const ZOMBIE_BODY_H = 68;
const ZOMBIE_BODY_OFF_X = Math.round((ZOMBIE_W * ZOMBIE_SCALE - ZOMBIE_BODY_W) / 2);
const ZOMBIE_BODY_OFF_Y = Math.round((ZOMBIE_H * ZOMBIE_SCALE * ZOMBIE_ORIGIN_Y) - ZOMBIE_BODY_H);
const LANDING_TOL = 18;
const LANDING_MIN_VEL = 45;
const SUPPORT_EDGE_MARGIN = 14;
const EDGE_DROP_VEL = 140;

// ─── BOOT SCENE ──────────────────────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super({ key:'BootScene' }); }

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
        fontFamily:'"Courier New",monospace',
        fontSize:'26px',
        fontStyle:'bold',
        color:'#f0c040',
        align:'center',
        stroke:'#000',
        strokeThickness:6,
      }).setOrigin(0.5);
    }
    if (!bootOk) return;
    if (d) d.textContent = 'boot->menu';
    this.scene.start('MenuScene');
  }
}

// ─── MENU SCENE ──────────────────────────────────────────────────────────────
class MenuScene extends Phaser.Scene {
  constructor() { super({ key:'MenuScene' }); }

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
        { leftX:-12, topY:250, width:150, fillDepth:170, depth:4 },
        { leftX:208, topY:156, width:wide1, landKey:'land1', fillDepth:30, depth:4 },
        { leftX:430, topY:320, width:wide4, landKey:'land4', fillDepth:78, depth:4 },
        { leftX:664, topY:114, width:wide4, landKey:'land4', fillDepth:92, depth:4 },
      ].forEach((cfg) => createChunkVisual(this, cfg));

      this.add.image(78, 248, 'bush').setOrigin(0.5, 1).setScale(1.05).setDepth(5);
      this.add.image(104, 248, 'tombstone').setOrigin(0.5, 1).setScale(1.02).setDepth(5);
      if (d) d.textContent = 'menu:ground';

      const title = this.add.text(18, 18, 'ZOMBIE HOP', {
        fontFamily:'"Courier New",monospace', fontSize:'18px', fontStyle:'bold',
        color:'#f0c040', stroke:'#000', strokeThickness:5,
      }).setOrigin(0, 0).setDepth(20);
      if (d) d.textContent = 'menu:title';

      this.add.text(20, 42, 'graveyard run', {
        fontFamily:'"Courier New",monospace', fontSize:'9px', color:'#7de8c0',
      }).setOrigin(0, 0).setDepth(20);

      const startPanel = this.add.rectangle(112, 92, 184, 54, 0x000000, 0.45)
        .setStrokeStyle(2, 0x4dba88, 0.55)
        .setDepth(19);

      const btn = this.add.text(112, 86, '  PLAY  ', {
        fontFamily:'"Courier New",monospace', fontSize:'14px', fontStyle:'bold',
        color:'#111111', backgroundColor:'#f0c040',
        padding:{x:20, y:7},
      }).setOrigin(0.5).setDepth(20).setInteractive({ useHandCursor:true });

      btn.on('pointerover',  () => btn.setStyle({ backgroundColor:'#ffe066', color:'#000' }));
      btn.on('pointerout',   () => btn.setStyle({ backgroundColor:'#f0c040', color:'#111111' }));
      btn.on('pointerup',  () => this._startGame());
      this.input.keyboard.addKey('ENTER').on('up', () => this._startGame());
      this.input.keyboard.addKey('SPACE').on('up', () => this._startGame());

      const best = parseInt(localStorage.getItem('zb_best') || '0');
      if (best > 0) {
        this.add.text(W - 18, 20, `BEST ${best}`, {
          fontFamily:'"Courier New",monospace', fontSize:'11px',
          color:'#ffd700', stroke:'#000', strokeThickness:3,
        }).setOrigin(1, 0).setDepth(20);
      }

      const zb = this.add.image(38, 250, 'zombie')
        .setOrigin(0.5, ZOMBIE_ORIGIN_Y)
        .setScale(ZOMBIE_SCALE * 0.94)
        .setDepth(6);

      // Title pulse
      this.tweens.add({ targets:title, alpha:0.75, duration:1200,
        yoyo:true, repeat:-1, ease:'Sine.easeInOut' });

      // Button glow pulse
      this.tweens.add({ targets:btn, scaleX:1.04, scaleY:1.04, duration:700,
        yoyo:true, repeat:-1, ease:'Sine.easeInOut' });

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
    void apiPost('/sessions', { player_name:playerName }).then((res) => {
      if (res?.session_id) sessionId = res.session_id;
    });
    this.scene.start('GameScene');
  }
}

// ─── GAME SCENE ──────────────────────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super({ key:'GameScene' }); }

  create() {
    this.speed     = INIT_SPD;
    this.score     = 0;
    this.dist      = 0;
    this.coins     = 0;
    this.over      = false;
    this.jumpsUsed = 0;
    this.coyote    = 0;
    this.platforms = [];
    // nextX = current screen x of right edge of last generated platform
    // decreases each frame as the world scrolls
    this.nextX     = 0;
    this.prevY     = GROUND_Y;
    this.supportPlat = null;
    this.inputLockedUntil = 0;
    this.inputReady = false;
    this.lastLandKey = 'land4';

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
      .setScale(ZOMBIE_SCALE);
    this.zombie.body
      .setSize(ZOMBIE_BODY_W, ZOMBIE_BODY_H, false)
      .setOffset(ZOMBIE_BODY_OFF_X, ZOMBIE_BODY_OFF_Y);
    this.supportPlat = startPlat.go;
    this._snapZombieToSurface(startPlat.go.body.top);
    this.zombie.body.setAllowGravity(false);

    // ── Collider: only resolve when zombie is moving downward (landing) ───
    // This prevents side-on hits from platforms scrolling under the zombie
    // from pushing it sideways and triggering a false game-over.
    this.physics.add.collider(
      this.zombie, this.platGroup,
      (_zb, plat) => this._onLand(plat),
      (_zb, plat) => this._isLandingOnTop(plat),
      this
    );

    // Input
    if (JUMP_ENABLED) {
      const doJump = () => this._jump();
      this.jumpKeys = [
        this.input.keyboard.addKey('SPACE'),
        this.input.keyboard.addKey('UP'),
      ];
      this.jumpKeys.forEach((key) => key.on('down', doJump));
      this.input.on('pointerdown', doJump);
    } else {
      this.jumpKeys = [];
    }
    this.inputLockedUntil = this.time.now + INPUT_GRACE_MS;

    // Difficulty ramp
    this.diffTimer = this.time.addEvent({
      delay:DIFF_MS, loop:true,
      callback:() => {
        if (!this.over) { this.speed = Math.min(this.speed + SPD_STEP, MAX_SPD); Sfx.speedUp(); }
        this.spdTxt.setText('SPD ' + ((this.speed - INIT_SPD) / SPD_STEP + 1).toFixed(0) + 'x');
      },
    });

    // Periodic score sync
    this.time.addEvent({
      delay:2000, loop:true,
      callback:() => {
        if (sessionId && !this.over)
          apiPost(`/sessions/${sessionId}/score`, { score:this.score, distance:Math.floor(this.dist) });
      },
    });

    // HUD
    const hs = { fontFamily:'"Courier New",monospace', fontSize:'11px',
      color:'#f0c040', stroke:'#000000', strokeThickness:3 };
    this.add.rectangle(W/2, 15, W, 30, 0x000000, 0.65).setDepth(10);
    // Accent line under HUD bar
    this.add.rectangle(W/2, 29, W, 2, 0x4dba88, 1).setDepth(10);

    this.scoreTxt = this.add.text(12,  4, 'SCORE  0',  hs).setDepth(11);
    this.coinTxt  = this.add.text(150, 4, '● 0',
      { ...hs, color:'#ffd700' }).setDepth(11);
    this.bestTxt  = this.add.text(W/2, 4,
      'BEST  ' + (localStorage.getItem('zb_best') || '0'), hs)
      .setOrigin(0.5, 0).setDepth(11);
    this.spdTxt   = this.add.text(W - 12, 4, 'SPD 1x',
      { ...hs, color:'#7de8c0' }).setOrigin(1, 0).setDepth(11);

  }

  _chooseFillDepth(topY, isStart, landKey) {
    if (isStart) return H - topY - 10;
    if (topY > H * 0.63) return Phaser.Math.Between(88, 154);
    if (topY > H * 0.48) return Phaser.Math.Between(54, 108);
    if (landKey) return Phaser.Math.Between(18, 44);
    return Phaser.Math.Between(0, 24);
  }

  _buildPathCoins(leftX, topY, width, isStart) {
    const coinArr = [];
    if (isStart || width < 100) return coinArr;

    const count = Phaser.Math.Clamp(Math.round(width / 72), 2, 5);
    const startX = Math.min(COIN_PATH_INSET, width / 2);
    const endX = Math.max(width - COIN_PATH_INSET, width / 2);

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const rx = Math.round(Phaser.Math.Linear(startX, endX, t));
      const baseY = topY - COIN_HOVER;
      const sprite = this.add.image(leftX + rx, baseY, 'coin').setDepth(5);
      coinArr.push({ sprite, rx, baseY, phase: 0, collected: false });
    }

    return coinArr;
  }

  // ─── Spawn one platform ─────────────────────────────────────────────────
  _spawn(leftX, topY, width, isStart = false, landKey = null) {
    if (!isStart && !landKey && this.textures.exists('land1')) {
      landKey = (this.lastLandKey === 'land1' && this.textures.exists('land4')) ? 'land4' : 'land1';
    }
    if (landKey && LAND_CFGS[landKey]) width = LAND_CFGS[landKey].rw;

    const fillDepth = this._chooseFillDepth(topY, isStart, landKey);
    const chunk = createChunkVisual(this, { leftX, topY, width, landKey, fillDepth, depth:4 });
    const ts = chunk.top;

    // Physics body: dynamic, immovable, no gravity
    // Body is positioned at the center of the platform
    const cx = leftX + width / 2;
    const cy = topY  + PLAT_H / 2;
    const go = this.platGroup.create(cx, cy, null);
    go.setVisible(false);
    go.body.allowGravity = false;
    go.body.immovable    = true;
    // setSize with offset=0,0 centers the body on the game object (origin 0.5)
    // body.left = go.x - width/2 = leftX  ✓
    // body.top  = go.y - PLAT_H/2 = topY  ✓
    go.body.setSize(width, PLAT_H, true);

    const coinArr = this._buildPathCoins(leftX, topY, width, isStart);

    const plat = { leftX, topY, width, ts, go, decor:[], coins:coinArr, visuals:chunk.visuals };
    this.platforms.push(plat);
    // Skip procedural decorations for land elements — they have decorations baked in
    if (!isStart && !landKey && width >= 80) this._addDecor(plat);
    return plat;
  }

  _addDecor(plat) {
    const pool  = ['skull','skull','crate','tombstone','bone','bone','sign','bush'];
    const count = Phaser.Math.Between(0, Math.min(2, Math.ceil(plat.width / 90)));
    const slots = new Set();
    for (let i = 0; i < count; i++) {
      let rx, t = 0;
      do { rx = Phaser.Math.Between(16, plat.width - 16); t++; }
      while (slots.has(Math.floor(rx / 40)) && t < 10);
      slots.add(Math.floor(rx / 40));
      const sp = this.add.image(plat.leftX + rx, plat.topY - 2,
                   Phaser.Utils.Array.GetRandom(pool)).setOrigin(0.5,1);
      plat.decor.push({ sprite:sp, rx });
    }
  }

  // ─── Procedural generation ───────────────────────────────────────────────
  _gen() {
    const earlyGame = this.dist < 1800;
    const maxGap    = this.speed * AIR_TIME * 0.6;
    const gap       = CONTINUOUS_GROUND
      ? 0
      : Phaser.Math.Between(
          GAP_MIN,
          earlyGame ? Math.min(maxGap * 0.38, 110) : Math.min(maxGap, 180)
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
      width   = LAND_CFGS[landKey].rw;
    } else {
      width = Phaser.Math.Between(
        earlyGame ? 190 : 110,
        earlyGame ? 280 : 240
      );
    }

    const maxClimb = Math.min(110, ((JUMP_VEL*JUMP_VEL)/(2*GRAVITY)) - 40);
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

  // ─── Jump ────────────────────────────────────────────────────────────────
  _jump() {
    if (this.over || !JUMP_ENABLED) return;
    if (!this.inputReady) return;
    if (this.time.now < this.inputLockedUntil) return;
    if (this.jumpsUsed < 1 && (this._isGrounded() || this.coyote > 0)) {
      this._clearSupportedPlatform(true);
      this.zombie.body.setVelocityY(JUMP_VEL);
      this.jumpsUsed++;
      this.coyote = 0;
      Sfx.jump();
    }
  }

  _isGrounded() {
    const body = this.zombie.body;
    return body.blocked.down || body.touching.down || this.supportPlat !== null;
  }

  _isLandingOnTop(plat) {
    const body = this.zombie.body;
    const platBody = plat.body;
    const prevBottom = body.prev.y + body.height;
    const overlapX = body.right > platBody.left + 6 && body.left < platBody.right - 6;
    const comingFromAbove = prevBottom <= platBody.top + LANDING_TOL;
    return overlapX && comingFromAbove && body.velocity.y >= LANDING_MIN_VEL;
  }

  _snapZombieToSurface(surfaceY) {
    this.zombie.setY(surfaceY);
    this.zombie.body.updateFromGameObject();
    this.zombie.body.prev.y = this.zombie.body.y;
  }

  _setSupportedPlatform(plat) {
    if (!plat?.body) return;
    this.supportPlat = plat;
    this._snapZombieToSurface(plat.body.top);
    this.zombie.body.setAllowGravity(false);
    this.zombie.body.setVelocityY(0);
  }

  _clearSupportedPlatform(keepVelocity = false) {
    const hadSupport = this.supportPlat !== null;
    this.supportPlat = null;
    this.zombie.body.setAllowGravity(true);
    if (!keepVelocity && hadSupport && this.zombie.body.velocity.y < EDGE_DROP_VEL) {
      this.zombie.body.setVelocityY(EDGE_DROP_VEL);
    }
  }

  _onLand(plat) {
    this._setSupportedPlatform(plat);
    if (this.jumpsUsed > 0) Sfx.land();
    this.jumpsUsed = 0;
    this.coyote = 120;
  }

  _isStillSupportedBy(plat) {
    if (!plat?.body) return false;
    const body = this.zombie.body;
    const platBody = plat.body;
    const edgeMargin = Math.min(SUPPORT_EDGE_MARGIN, platBody.width * 0.25);
    const centerX = body.center.x;
    const overlapX = centerX >= platBody.left + edgeMargin && centerX <= platBody.right - edgeMargin;
    const footY = this.zombie.y;
    const onSameSurface = footY >= platBody.top - 4 && footY <= platBody.top + 8;
    return overlapX && onSameSurface && body.velocity.y > -LANDING_MIN_VEL;
  }

  // ─── Coin collected ──────────────────────────────────────────────────────
  _collectCoin(coin, cx, cy) {
    coin.collected = true;
    coin.sprite.destroy();
    this.coins++;
    this.coinTxt.setText('● ' + this.coins);

    const popup = this.add.text(cx, cy - 8, `+${COIN_VAL}`, {
      fontFamily:'"Courier New",monospace', fontSize:'13px', color:'#ffd700',
      stroke:'#000', strokeThickness:3,
    }).setOrigin(0.5,1).setDepth(20);
    this.tweens.add({ targets:popup, y:cy-34, alpha:0, duration:580, ease:'Cubic.easeOut',
      onComplete:() => popup.destroy() });

    this.zombie.setTint(0xffd700);
    this.time.delayedCall(90, () => this.zombie.clearTint());
  }

  // ─── Update ──────────────────────────────────────────────────────────────
  update(_, delta) {
    if (this.over) return;
    const dt  = Math.min(delta, MAX_FRAME_MS) / 1000;
    const now = this.time.now;

    this.zombie.setScale(ZOMBIE_SCALE);
    this.zombie.setAngle(0);

    if (!this.inputReady) {
      const holdingJumpKey = this.jumpKeys?.some((key) => key.isDown);
      const holdingPointer = this.input.activePointer.isDown;
      if (now >= this.inputLockedUntil && !holdingJumpKey && !holdingPointer) {
        this.inputReady = true;
      }
    }

    if (this.coyote > 0) this.coyote -= delta;

    // Scroll platforms
    const dx = this.speed * dt;  // pixels to move left this frame

    for (let i = this.platforms.length - 1; i >= 0; i--) {
      const p = this.platforms[i];
      p.leftX -= dx;

      // ── Move dynamic physics body ──────────────────────────────────────
      // Set body position directly each frame; velocity stays 0 so the
      // physics step doesn't move it again.  Dynamic bodies update their
      // internal spatial tree automatically, so collision detection is
      // always accurate regardless of how we move the body.
      p.go.x              = p.leftX + p.width / 2;
      p.go.y              = p.topY  + PLAT_H / 2;
      p.go.body.reset(p.go.x, p.go.y);

      // ── Move visual chunk ──────────────────────────────────────────────
      for (const v of p.visuals) v.sprite.x = p.leftX + v.offsetX;

      // ── Decor ─────────────────────────────────────────────────────────
      for (const d of p.decor) d.sprite.x = p.leftX + d.rx;

      // ── Coins: move + collect ──────────────────────────────────────────
      for (const coin of p.coins) {
        if (coin.collected) continue;
        coin.baseY -= dx;   // scroll with platform
        const cx = p.leftX + coin.rx;
        const cy = coin.baseY + (COIN_BOB ? Math.sin(now * COIN_SPEED + coin.phase) * COIN_BOB : 0);
        coin.sprite.x = cx;
        coin.sprite.y = cy;

        // Collection check
        const ddx = cx - this.zombie.body.center.x;
        const ddy = cy - this.zombie.body.center.y;
        if (ddx*ddx + ddy*ddy < COIN_R2) {
          Sfx.coin();
          this._collectCoin(coin, cx, cy);
        }
      }

      // Cull off-screen
      if (p.leftX + p.width < -160) {
        p.go.destroy();
        for (const v of p.visuals) v.sprite.destroy();
        for (const d of p.decor) d.sprite.destroy();
        for (const c of p.coins) if (!c.collected) c.sprite.destroy();
        this.platforms.splice(i, 1);
      }
    }

    // ── Infinite generation ───────────────────────────────────────────────
    // nextX scrolls left with the world; generate whenever the frontier
    // is less than 700px beyond the right edge of the screen.
    this.nextX -= dx;
    while (this.nextX < W + 360) this._gen();

    if (this.supportPlat && this._isStillSupportedBy(this.supportPlat)) {
      this._setSupportedPlatform(this.supportPlat);
      this.coyote = 120;
    } else {
      this._clearSupportedPlatform();
    }

    // ── Score ─────────────────────────────────────────────────────────────
    this.dist += this.speed * dt;
    this.score = Math.floor(this.dist / 8) + this.coins * COIN_VAL;
    this.scoreTxt.setText('SCORE  ' + this.score);
    const best = parseInt(localStorage.getItem('zb_best') || '0');
    if (this.score > best) {
      localStorage.setItem('zb_best', this.score);
      this.bestTxt.setText('BEST  ' + this.score);
    }

    // Die only when fallen into a gap (below screen)
    if (this.zombie.body.top > H + 100) this._die();
  }

  async _die() {
    if (this.over) return;
    this.over = true;
    this.diffTimer.remove();
    if (sessionId) {
      void apiPost(`/sessions/${sessionId}/end`, {
        score:this.score,
        distance:Math.floor(this.dist),
      });
    }
    Sfx.die();
    this.cameras.main.shake(300, 0.014);
    this.time.delayedCall(520, () =>
      this.scene.start('GameOverScene', { score:this.score, distance:Math.floor(this.dist), coins:this.coins })
    );
  }
}

// ─── GAME OVER SCENE ─────────────────────────────────────────────────────────
class GameOverScene extends Phaser.Scene {
  constructor() { super({ key:'GameOverScene' }); }
  init(d) { this.finalScore = d.score||0; this.finalDist = d.distance||0; this.finalCoins = d.coins||0; }

  async create() {
    addBackground(this);
    this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.55);

    let go;
    if (this.textures.exists('gameOverImg')) {
      const s = OVERLAY_WORDMARK_W / 2104;
      go = this.add.image(W/2, H/2 - 92, 'gameOverImg').setOrigin(0.5).setScale(s);
      this.tweens.add({ targets:go, scaleX:{from:s*0.08, to:s}, scaleY:{from:s*0.08, to:s}, duration:460, ease:'Back.easeOut' });
    } else {
      go = this.add.text(W/2, H/2 - 92, 'GAME OVER', {
        fontFamily:'"Courier New",monospace', fontSize:'36px', fontStyle:'bold',
        color:'#f0a024', stroke:'#ffffff', strokeThickness:8,
        shadow:{offsetX:5,offsetY:5,color:'#7a3600',fill:true},
      }).setOrigin(0.5);
      this.tweens.add({ targets:go, scaleX:{from:0.08,to:1}, scaleY:{from:0.08,to:1}, duration:460, ease:'Back.easeOut' });
    }

    this.add.text(W/2, H/2+4,  `Score: ${this.finalScore}`,
      { fontFamily:'"Courier New",monospace', fontSize:'26px', color:'#f0c040' }).setOrigin(0.5);
    this.add.text(W/2, H/2+34, `Distance: ${this.finalDist} m`,
      { fontFamily:'"Courier New",monospace', fontSize:'15px', color:'#d0c8a8' }).setOrigin(0.5);
    this.add.text(W/2, H/2+56, `Coins: ${this.finalCoins}`,
      { fontFamily:'"Courier New",monospace', fontSize:'15px', color:'#ffd700' }).setOrigin(0.5);

    const lb = await apiGet('/leaderboard');
    if (lb?.scores?.length) {
      this.add.text(W/2, H/2+78, '─── TOP SCORES ───',
        { fontFamily:'"Courier New",monospace', fontSize:'11px', color:'#555' }).setOrigin(0.5);
      lb.scores.slice(0,4).forEach((s,i) => {
        this.add.text(W/2, H/2+94+i*18, `${i+1}.  ${s.player_name}   ${s.score}`, {
          fontFamily:'"Courier New",monospace', fontSize:'12px',
          color: i===0 ? '#f0c040' : '#b8b098',
        }).setOrigin(0.5);
      });
    }

    const hint = this.add.text(W/2, H-22, 'SPACE  /  TAP  to restart',
      { fontFamily:'"Courier New",monospace', fontSize:'12px', color:'#555' }).setOrigin(0.5);
    this.tweens.add({ targets:hint, alpha:0, duration:720, yoyo:true, repeat:-1 });

    let restarting = false;
    const restart = () => {
      if (restarting) return;
      restarting = true;
      sessionId = null;
      void apiPost('/sessions', { player_name:playerName }).then((res) => {
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
    type:   Phaser.AUTO,
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
      mode:       Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: W, height: H,
      min: { width:320, height:157 },
      max: { width:1920, height:940 },
    },
    physics: {
      default: 'arcade',
      arcade:  { gravity:{ y:0 }, debug:false },
    },
    scene: [BootScene, MenuScene, GameScene, GameOverScene],
  });

  // Probe: show when Phaser has fully booted (fires asynchronously)
  phaserGame.events.once('ready', function () {
    var d = document.getElementById('diag');
    if (d && !/^menu:|^game:|^boot:/.test(d.textContent)) d.textContent = 'phaser ready';
  });
};
