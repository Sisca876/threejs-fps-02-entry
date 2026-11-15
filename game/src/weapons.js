// The arsenal: five guns with distinct roles, prices and feel. Spread is the heart of
// the tactics: standing still (and crouching) is accurate, moving is not, and the
// sniper is only precise while scoped. Each gun gets its own view model built from
// boxes, a muzzle flash, and a reload animation. main.js owns the ray; this module
// owns the numbers and the model.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp } from './util.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', slot: 2, name: 'P9 Sidearm', short: 'P9', price: 0, kind: 'Pistol',
    damage: 26, headMul: 3.0, mag: 12, reserve: 48, gap: 0.15, auto: false, reload: 1.4,
    spreadStill: 0.004, spreadMove: 0.02, spreadAir: 0.03, pellets: 1, kick: 0.011, range: 42,
    desc: 'Reliable sidearm. Accurate when still, free forever.',
  },
  smg: {
    id: 'smg', slot: 1, name: 'M9 Ripper', short: 'M9', price: 1400, kind: 'SMG',
    damage: 24, headMul: 2.6, mag: 32, reserve: 96, gap: 0.074, auto: true, reload: 1.8,
    spreadStill: 0.007, spreadMove: 0.03, spreadAir: 0.04, pellets: 1, kick: 0.0075, range: 34,
    desc: 'Fast close-range shredder. Sprays wide on the move.',
  },
  rifle: {
    id: 'rifle', slot: 1, name: 'K7 Carbine', short: 'K7', price: 2700, kind: 'Rifle',
    damage: 34, headMul: 3.2, mag: 30, reserve: 90, gap: 0.096, auto: true, reload: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, spreadAir: 0.035, pellets: 1, kick: 0.01, range: 55,
    desc: 'The workhorse. Deadly in short, still bursts.',
  },
  shotgun: {
    id: 'shotgun', slot: 1, name: 'R4 Scattergun', short: 'R4', price: 1500, kind: 'Shotgun',
    damage: 9, headMul: 1.6, mag: 7, reserve: 28, gap: 0.8, auto: false, reload: 2.4,
    spreadStill: 0.045, spreadMove: 0.06, spreadAir: 0.07, pellets: 8, kick: 0.032, range: 18,
    desc: 'Eight pellets per shell. Devastating up close, harmless far away.',
  },
  sniper: {
    id: 'sniper', slot: 1, name: 'LR-80 Marksman', short: 'LR-80', price: 4200, kind: 'Sniper',
    damage: 95, headMul: 2.0, mag: 5, reserve: 15, gap: 1.1, auto: false, reload: 2.8,
    spreadStill: 0.0006, spreadMove: 0.05, spreadAir: 0.06, pellets: 1, kick: 0.038, range: 90,
    desc: 'One shot, one down — but only while scoped and still.',
  },
};

export const ARMOR_PRICE = 650;
export const ARMOR_NAME = 'Kevlar Vest';

const MUZZLE_TIME = 0.055;

export function createWeapons(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.metalDark), roughness: 0.65, metalness: 0.35 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.metal), roughness: 0.45, metalness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const woodMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.crateDark), roughness: 0.8, metalness: 0 });

  function part(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    return mesh;
  }

  // One silhouette per gun, all built from boxes.
  function buildModel(id) {
    const g = new THREE.Group();
    if (id === 'pistol') {
      g.add(part(0.05, 0.07, 0.24, 0, 0.02, -0.08, bodyMat));
      g.add(part(0.045, 0.12, 0.06, 0, -0.06, 0.03, gripMat));
      g.add(part(0.02, 0.02, 0.06, 0, 0.06, -0.18, accentMat));
    } else if (id === 'smg') {
      g.add(part(0.07, 0.08, 0.34, 0, 0.02, -0.05, bodyMat));
      g.add(part(0.04, 0.04, 0.22, 0, 0.03, -0.3, gripMat));
      g.add(part(0.05, 0.14, 0.05, 0, -0.06, -0.08, gripMat));
      g.add(part(0.05, 0.07, 0.16, 0, -0.01, 0.2, gripMat));
    } else if (id === 'rifle') {
      g.add(part(0.08, 0.09, 0.44, 0, 0.02, -0.06, bodyMat));
      g.add(part(0.04, 0.04, 0.36, 0, 0.035, -0.42, gripMat));
      g.add(part(0.055, 0.15, 0.06, 0, -0.07, -0.1, gripMat));
      g.add(part(0.06, 0.07, 0.2, 0, -0.01, 0.26, woodMat));
      g.add(part(0.03, 0.04, 0.12, 0, 0.085, -0.08, accentMat));
    } else if (id === 'shotgun') {
      g.add(part(0.08, 0.09, 0.4, 0, 0.02, -0.04, woodMat));
      g.add(part(0.05, 0.05, 0.44, 0, 0.045, -0.36, bodyMat));
      g.add(part(0.055, 0.09, 0.14, 0, 0.0, -0.2, gripMat));
      g.add(part(0.06, 0.08, 0.22, 0, -0.02, 0.26, woodMat));
    } else {
      g.add(part(0.07, 0.08, 0.5, 0, 0.02, -0.1, bodyMat));
      g.add(part(0.035, 0.035, 0.5, 0, 0.03, -0.52, gripMat));
      g.add(part(0.06, 0.06, 0.16, 0, 0.09, -0.12, gripMat));
      g.add(part(0.05, 0.05, 0.1, 0, 0.09, -0.3, accentMat));
      g.add(part(0.055, 0.07, 0.24, 0, -0.01, 0.28, woodMat));
      g.add(part(0.03, 0.12, 0.04, 0, -0.05, -0.28, gripMat));
    }
    return g;
  }

  const models = {};
  for (const id of Object.keys(WEAPONS)) {
    models[id] = buildModel(id);
    models[id].scale.setScalar(0.85);
    models[id].position.set(0.25, -0.21, -0.4);
    models[id].visible = false;
    camera.add(models[id]);
  }

  // Soft radial glow for the muzzle flash, painted once on a canvas.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64;
  glowCanvas.height = 64;
  {
    const g = glowCanvas.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.35, 'rgba(255,190,90,0.85)');
    grad.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const glowTexture = new THREE.CanvasTexture(glowCanvas);

  // Barrel-tip offsets in each model's local space, so the flash rides the gun.
  const TIPS = {
    pistol: [0, 0.02, -0.22],
    smg: [0, 0.03, -0.43],
    rifle: [0, 0.035, -0.62],
    shotgun: [0, 0.045, -0.6],
    sniper: [0, 0.03, -0.79],
  };
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ map: glowTexture, color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(...TIPS.pistol);
  flash.visible = false;
  models.pistol.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.25, -0.17, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    mag: {}, reserve: {},
    cooldown: 0, reloadLeft: 0, reloadTotal: 1, flash: 0, kick: 0, swapLeft: 0,
    bobPhase: 0, swayX: 0, swayY: 0,
  };
  for (const def of Object.values(WEAPONS)) {
    state.mag[def.id] = def.mag;
    state.reserve[def.id] = def.reserve;
  }

  function model() {
    return models[state.current];
  }

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt, speed, lookDelta) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    state.swapLeft = Math.max(0, state.swapLeft - dt);
    state.swayX += (clamp(-lookDelta.x * 0.0006, -0.03, 0.03) - state.swayX) * Math.min(1, dt * 10);
    state.swayY += (clamp(lookDelta.y * 0.0006, -0.03, 0.03) - state.swayY) * Math.min(1, dt * 10);
    state.bobPhase += dt * (2 + speed * 1.4);
    const bob = Math.min(1, speed / 5) * 0.011;
    const m = model();
    const lowered = state.swapLeft > 0 ? Math.min(1, state.swapLeft * 4) * 0.22 : 0;
    m.position.set(
      0.25 + state.swayX,
      -0.21 + state.swayY - lowered + Math.sin(state.bobPhase * 2) * bob,
      -0.4 + state.kick + Math.cos(state.bobPhase) * bob * 0.6,
    );
    m.rotation.x = state.kick * 2.1 + (state.reloadLeft > 0 ? -0.5 * Math.sin((1 - state.reloadLeft / state.reloadTotal) * Math.PI) : 0);
    m.rotation.z = state.swayX * 1.4;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 34;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const d = def();
        const take = Math.min(d.mag - state.mag[d.id], state.reserve[d.id]);
        state.mag[d.id] += take;
        state.reserve[d.id] -= take;
      }
    }
  }

  return {
    state,
    def,
    step,
    ready() {
      return state.mag[state.current] > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.swapLeft === 0;
    },
    canFire() {
      return state.cooldown === 0 && state.reloadLeft === 0 && state.swapLeft === 0;
    },
    pullTrigger() {
      const d = def();
      state.cooldown = d.gap;
      state.flash = MUZZLE_TIME;
      state.kick = d.id === 'sniper' ? 0.075 : d.id === 'shotgun' ? 0.07 : 0.045;
    },
    takeRound() {
      if (state.mag[state.current] <= 0) return false;
      state.mag[state.current] -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag[d.id] === d.mag || state.reserve[d.id] === 0) return false;
      state.reloadLeft = d.reload;
      state.reloadTotal = d.reload;
      return true;
    },
    equip(id) {
      if (!WEAPONS[id] || id === state.current || state.swapLeft > 0) return false;
      models[state.current].visible = false;
      state.current = id;
      state.reloadLeft = 0;
      state.swapLeft = 0.28;
      models[id].visible = true;
      models[id].add(flash);
      flash.position.set(...TIPS[id]);
      return true;
    },
    show() {
      models[state.current].visible = true;
    },
    hide() {
      for (const m of Object.values(models)) m.visible = false;
    },
    refill(id) {
      const d = WEAPONS[id];
      state.mag[id] = d.mag;
      state.reserve[id] = d.reserve;
    },
    // Spread in radians: still < walking < running < airborne; crouching tightens it.
    spread(speed, airborne, crouching, scoped) {
      const d = def();
      let base = d.spreadStill;
      if (d.id === 'sniper' && !scoped) base = 0.05;
      const move = clamp(speed / 5.2, 0, 1) * d.spreadMove;
      const air = airborne ? d.spreadAir : 0;
      let total = base + move + air;
      if (crouching) total *= 0.7;
      if (scoped && d.id !== 'sniper') total *= 0.75;
      return total;
    },
    damageAt(distance) {
      const d = def();
      if (distance <= 14) return d.damage;
      if (distance >= d.range) return Math.round(d.damage * 0.55);
      return Math.round(d.damage * (1 - 0.45 * (distance - 14) / (d.range - 14)));
    },
    muzzleWorld(out) {
      return out.set(0.25, -0.19, -0.92).applyMatrix4(camera.matrixWorld);
    },
  };
}
