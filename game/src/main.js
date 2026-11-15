// EMBERLINE boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. This module wires the world, player, weapons, bots, HUD, audio
// and match together, owns the shooting raycasts and the effects (tracers, impacts,
// muzzle flashes, the spike explosion), and runs the deterministic ?shot= captures.
// ?shot=start|play|buy|end with &seed=N sets up a frame, renders it twice, freezes
// it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, clamp, damp, formatMoney } from './util.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, ARMOR_PRICE } from './weapons.js';
import { createBotManager } from './bots.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createMatch, FREEZE_TIME, ROUND_TIME, SPIKE_TIME, WIN_TARGET, START_MONEY, PLANT_TIME } from './match.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = shot ? mulberry32(seed) : mulberry32((Math.random() * 0x7fffffff) | 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 45, 150);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 320);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud(world);
const audio = createAudio();
const player = createPlayer(world.colliders);
const weapons = createWeapons(camera);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// --- Player state (the bots live in the manager; the match owns money/rounds).
const playerState = { hp: 100, armor: 0, alive: true, kills: 0, deaths: 0, primary: null, survived: true };
const playerCombatant = {
  isPlayer: true, name: 'Fazz', team: 'attack',
  get alive() { return playerState.alive; },
};
const playerView = {
  position: player.state.position,
  get crouching() { return player.state.crouching; },
  get alive() { return playerState.alive; },
};

let simTime = 0;
let started = false;
let buyOpen = false;
let paused = false;
let frozenShot = false;
let lastPlayerShotAt = -99;
let threat = null;
let pings = [];
let trauma = 0;
let fov = 74;
let scoped = false;
let aiming = false;
let prevFiring = false;
let plantChannel = null;
let nextBeepAt = 0;
let deathYaw = 0;

// --- Spike mesh: a compact device with a blinking beacon.
const spikeGroup = new THREE.Group();
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.metalDark), roughness: 0.5, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.24), bodyMat);
  body.position.y = 0.11;
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), bodyMat);
  antenna.position.set(0.1, 0.36, 0.06);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }));
  lamp.position.set(-0.08, 0.26, 0);
  lamp.name = 'spikeLamp';
  spikeGroup.add(body, antenna, lamp);
  spikeGroup.visible = false;
  scene.add(spikeGroup);
}
const spikePos = new THREE.Vector3();
const spikeView = {
  get state() { return match.state.spike.state; },
  get site() { return match.state.spike.site; },
  position: spikePos,
  get carrierId() { return match.state.spike.carrierId; },
};

// --- Effects pools: tracers, impact dust, muzzle flashes, explosion.
const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

function makePool(count, create) {
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const item = create();
    item.life = 0;
    items.push(item);
  }
  let cursor = 0;
  return {
    next() {
      const item = items[cursor];
      cursor = (cursor + 1) % items.length;
      return item;
    },
    update(dt, fn) {
      for (const item of items) if (item.life > 0) fn(item, dt);
    },
  };
}

const tracers = makePool(28, () => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe0a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  return { line, life: 0, max: 0.07 };
});
function spawnTracer(from, to, color) {
  const t = tracers.next();
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.color.set(color);
  t.line.visible = true;
  t.life = t.max;
}

const impacts = makePool(24, () => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false }));
  sprite.visible = false;
  scene.add(sprite);
  return { sprite, life: 0, max: 0.3, size: 0.4 };
});
function spawnImpact(point, color, size = 0.42) {
  const item = impacts.next();
  item.sprite.position.copy(point);
  item.sprite.material.color.set(color);
  item.sprite.scale.setScalar(size);
  item.sprite.visible = true;
  item.size = size;
  item.life = item.max;
}

const flashes = makePool(10, () => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }));
  sprite.visible = false;
  scene.add(sprite);
  return { sprite, life: 0, max: 0.05 };
});
function spawnFlash(point) {
  const item = flashes.next();
  item.sprite.position.copy(point);
  item.sprite.scale.setScalar(0.7);
  item.sprite.visible = true;
  item.life = item.max;
}

const explosion = { sprite: null, light: null, life: 0, max: 1.5 };
{
  explosion.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color('#ff9a3c'), transparent: true, opacity: 0, depthWrite: false }));
  explosion.sprite.visible = false;
  scene.add(explosion.sprite);
  explosion.light = new THREE.PointLight(new THREE.Color('#ff9a3c'), 0, 34, 1.6);
  scene.add(explosion.light);
}
function spawnExplosion(point) {
  explosion.sprite.position.set(point.x, 1.6, point.z);
  explosion.sprite.visible = true;
  explosion.light.position.set(point.x, 2.4, point.z);
  explosion.life = explosion.max;
  trauma = 1;
}

// --- Combat helpers.
const tmpDir = new THREE.Vector3();
const tmpOrigin = new THREE.Vector3();
const tmpPoint = new THREE.Vector3();
const tmpBox = new THREE.Box3();

function rayBox(origin, dir, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [min.x, min.y, min.z];
  const hi = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

function falloff(def, dist) {
  if (dist <= 14) return 1;
  if (dist >= def.range) return 0.55;
  return 1 - 0.45 * (dist - 14) / (def.range - 14);
}

function los(from, to) {
  tmpDir.copy(to).sub(from);
  const dist = tmpDir.length();
  tmpDir.normalize();
  raycaster.set(from, tmpDir);
  raycaster.far = dist - 0.3;
  return raycaster.intersectObjects(world.shootables, false).length === 0;
}

function aliveCounts() {
  return {
    attack: (playerState.alive ? 1 : 0) + manager.aliveCount('attack'),
    defend: manager.aliveCount('defend'),
  };
}

function refreshAliveHud() {
  const counts = aliveCounts();
  hud.setAlive(counts.attack, counts.defend);
}

// --- Match hooks.
function handleKill(victim, attacker, headshot, weaponId) {
  const weaponShort = weaponId ? WEAPONS[weaponId].short : '—';
  const victimName = victim.isPlayer ? 'Fazz' : victim.name;
  const attackerName = !attacker ? 'World' : attacker.isPlayer ? 'Fazz' : attacker.name;
  const attackerTeam = !attacker ? 'defend' : attacker.team;
  hud.killfeed(attackerName, attackerTeam, victimName, victim.team, weaponShort, headshot);
  if (attacker) {
    if (attacker.isPlayer) {
      playerState.kills += 1;
      match.killReward('player');
      hud.setMoney(match.getMoney('player'));
    } else {
      attacker.kills += 1;
      match.killReward(attacker.id);
    }
  }
  refreshAliveHud();
  match.checkElimination(aliveCounts());
}

function damagePlayer(amount, fromPos, attacker, weaponId) {
  if (!playerState.alive) return;
  let dmg = Math.round(amount);
  if (playerState.armor > 0) {
    const absorbed = Math.min(playerState.armor, Math.round(dmg * 0.5));
    playerState.armor -= absorbed;
    dmg -= absorbed;
  }
  playerState.hp -= dmg;
  audio.hurt();
  trauma = Math.min(1, trauma + 0.25);
  const angle = Math.atan2(-(fromPos.x - player.state.position.x), -(fromPos.z - player.state.position.z));
  hud.damageFrom(angle, player.state.yaw);
  hud.setHealth(playerState.hp, playerState.armor);
  if (playerState.hp <= 0) {
    playerState.alive = false;
    playerState.deaths += 1;
    playerState.survived = false;
    weapons.hide();
    deathYaw = player.state.yaw;
    plantChannel = null;
    hud.plantProgress(false, 0, '');
    hud.eventLine('You are down. Your team fights on — next round you return.', 4200);
    if (match.state.spike.state === 'player') {
      match.dropSpike(player.state.position);
      hud.eventLine('You dropped the spike!', 3200);
      hud.setSpike('none');
    }
    handleKill(playerCombatant, attacker, false, weaponId);
  }
}

const match = createMatch({
  random: rng,
  combatantTeams: () => [['player', 'attack'], ...manager.bots.map((b) => [b.id, b.team])],
  onRoundStart(round, site) {
    resetForRound();
    hud.setScore(match.state.scores.attack, match.state.scores.defend, round, WIN_TARGET);
    hud.banner(`ROUND ${round}`, `Buy phase — press B to shop · Target site ${site}`, 'info', 2400);
    hud.setSpike('carried');
    refreshAliveHud();
  },
  onPhaseChange(phase) {
    if (phase === 'live') {
      if (buyOpen) closeBuy(true);
      hud.eventLine('Round live — plant the spike at A or B, or eliminate the Sentinels.');
    }
  },
  onRoundEnd(winner, reason, scores) {
    const won = winner === 'attack';
    const reasonText = {
      elimination: won ? 'Enemy team eliminated.' : 'Your team was eliminated.',
      detonation: 'The spike detonated.',
      defuse: 'The spike was defused.',
      time: 'Time expired — the spike was never planted.',
    }[reason] ?? '';
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', `${reasonText}  VAN ${scores.attack} — ${scores.defend} SEN`, won ? 'win' : 'lose', 3400);
    if (won) audio.roundWin();
    else audio.roundLose();
    hud.setScore(scores.attack, scores.defend, match.state.round, WIN_TARGET);
    hud.setMoney(match.getMoney('player'));
    playerState.survived = playerState.alive;
    plantChannel = null;
    hud.plantProgress(false, 0, '');
    if (buyOpen) closeBuy(false);
  },
  onMatchEnd(winner, scores) {
    const won = winner === 'attack';
    hud.showOverlay('end', won
      ? `The Vanguard take the match <b>${scores.attack} — ${scores.defend}</b>. Relay Station Kestrel is yours, Fazz.`
      : `The Sentinels hold the station <b>${scores.defend} — ${scores.attack}</b>. Run it back?`);
    if (document.pointerLockElement) document.exitPointerLock();
    if (won) audio.roundWin();
    else audio.roundLose();
  },
  onSpikePlanted(site) {
    hud.setSpike('planted', site);
    hud.eventLine(`Spike planted at site ${site}! Defend it until detonation.`, 4200);
    audio.plant();
    threat = { site, at: simTime, planted: true };
    nextBeepAt = simTime + 0.8;
  },
  onSpikeDefused() {
    hud.eventLine('The spike was defused.', 3600);
    audio.defuse();
    threat = null;
  },
  onSpikeExploded(site) {
    spawnExplosion(spikePos);
    audio.explosion();
    hud.eventLine(`The spike detonated at site ${site}!`, 3600);
  },
});

function resetForRound() {
  const spawn = world.spawns.attack[0];
  player.reset(spawn.x, spawn.z, spawn.yaw);
  playerState.hp = 100;
  playerState.alive = true;
  if (!playerState.survived) {
    playerState.primary = null;
    playerState.armor = 0;
  }
  // Refill everything owned; survivors keep their guns.
  weapons.refill('pistol');
  if (playerState.primary) weapons.refill(playerState.primary);
  weapons.equip(playerState.primary ?? 'pistol');
  weapons.show();
  hud.setHealth(playerState.hp, playerState.armor);
  hud.setMoney(match.getMoney('player'));
  // Bots shop and take positions.
  const weaponsMap = {};
  for (const bot of manager.bots) weaponsMap[bot.id] = match.botLoadout(bot);
  manager.resetRound({ site: match.state.site, weapons: weaponsMap, spikeCarrier: null });
  spikeGroup.visible = false;
  plantChannel = null;
  threat = null;
  pings = [];
  hud.setSpike('carried');
}

// --- Bot hooks.
const manager = createBotManager(scene, world, {
  random: rng,
  get time() { return simTime; },
  los,
  getEnemies(bot) {
    const foes = manager.bots.filter((b) => b.team !== bot.team);
    foes.push(playerCombatant);
    return foes;
  },
  getPlayer: () => playerView,
  playerFiredRecently: () => simTime - lastPlayerShotAt < 1.5,
  playerSpeed: () => player.groundSpeed(),
  getPhase: () => match.state.phase,
  getSpike: () => spikeView,
  nearestAttacker: (pos) => manager.nearestAlive('attack', pos),
  nearestDefender: (pos) => manager.nearestAlive('defend', pos),
  getThreat: () => (threat && (threat.planted || simTime - threat.at < 6) ? threat.site : null),
  onShoot(bot, origin) {
    spawnFlash(origin);
    const dist = origin.distanceTo(player.state.position);
    audio.shot(bot.weaponId, dist);
    if (bot.team === 'defend') pings.push({ x: bot.group.position.x, z: bot.group.position.z, until: simTime + 1.2 });
    manager.hearShot(bot.group.position, true);
    markThreat(bot.group.position);
  },
  onStep(bot) {
    const dist = bot.group.position.distanceTo(player.state.position);
    audio.step(dist, true);
  },
  onKill(victim, attacker, headshot) {
    handleKill(victim, attacker, headshot, attacker && !attacker.isPlayer ? attacker.weaponId : weapons.def().id);
  },
  onSpikeDropped(position) {
    match.dropSpike(position);
    hud.setSpike('none');
    hud.eventLine('The spike was dropped!', 3000);
  },
  onPlant(bot) {
    const site = bot.assignedSite;
    if (match.plant(site, bot.group.position)) {
      hud.eventLine(`${bot.name} planted the spike at site ${site}!`, 3600);
    }
  },
  onDefuse(bot) {
    match.defuse();
  },
  onChannelStart() {},
  raycastShot(shooter, origin, dir, def, headshot) {
    raycaster.set(origin, dir);
    raycaster.far = 80;
    // No friendly fire: only the shooter's enemies are hittable.
    const targets = world.shootables.concat(manager.allHitMeshes().filter((m) => m.userData.bot.team !== shooter.team));
    const hit = raycaster.intersectObjects(targets, false)[0];
    let hitDist = hit ? hit.distance : 80;
    let hitPoint = hit ? hit.point : tmpPoint.copy(origin).addScaledVector(dir, 80);
    // Player capsule test — only defenders can hit the player.
    let playerHit = null;
    if (playerState.alive && shooter.team === 'defend') {
      const p = player.state.position;
      tmpBox.min.set(p.x - 0.34, p.y, p.z - 0.34);
      tmpBox.max.set(p.x + 0.34, p.y + player.state.height, p.z + 0.34);
      const t = rayBox(origin, dir, tmpBox.min, tmpBox.max);
      if (t !== null && t < hitDist) {
        const point = tmpPoint.copy(origin).addScaledVector(dir, t);
        playerHit = { dist: t, point: point.clone(), part: point.y > p.y + player.state.height - 0.34 ? 'head' : 'torso' };
        hitDist = t;
        hitPoint = playerHit.point;
      }
    }
    spawnTracer(origin, hitPoint, shooter.team === 'attack' ? 0xffd9a0 : 0xff8a7a);
    if (playerHit) {
      const dmg = def.damage * falloff(def, playerHit.dist) * (0.7 + shooter.skill * 0.3) * (playerHit.part === 'head' ? 2 : 1);
      damagePlayer(dmg, shooter.group.position, shooter, def.id);
    } else if (hit && hit.object.userData.bot) {
      const victim = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const dmg = def.damage * falloff(def, hit.distance) * (0.7 + shooter.skill * 0.3) * (part === 'head' ? 2.2 : part === 'legs' ? 0.8 : 1);
      const result = manager.damage(victim, dmg, part, shooter);
      if (result.dealt > 0) spawnImpact(hit.point, '#c94a4a', 0.3);
    } else if (hit) {
      spawnImpact(hit.point, '#d9c39a', 0.36);
    }
  },
});

function markThreat(pos) {
  for (const [site, data] of Object.entries(world.sites)) {
    const dx = pos.x - data.plant.x;
    const dz = pos.z - data.plant.z;
    if (dx * dx + dz * dz < 14 * 14) threat = { site, at: simTime, planted: false };
  }
}

// --- Input.
const input = createInput(renderer.domElement, onLockChange);
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    paused = false;
    hud.hideOverlay();
    audio.unlock();
  } else if (started && !buyOpen && match.state.phase !== 'over') {
    paused = true;
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'over' || match.state.phase === 'idle') {
    playerState.kills = 0;
    playerState.deaths = 0;
    playerState.survived = true;
    playerState.primary = null;
    playerState.armor = 0;
    for (const bot of manager.bots) {
      bot.kills = 0;
      bot.deaths = 0;
    }
    match.startMatch(['player', ...manager.bots.map((b) => b.id)]);
  }
  input.requestLock();
});

// --- Buy menu.
function ownedList() {
  const owned = ['pistol'];
  if (playerState.primary) owned.push(playerState.primary);
  if (playerState.armor > 0) owned.push('armor');
  return owned;
}
function openBuy() {
  buyOpen = true;
  hud.showBuy(true, match.getMoney('player'), ownedList());
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeBuy(relock) {
  buyOpen = false;
  hud.showBuy(false, 0, []);
  if (relock && started) input.requestLock();
}
function buyItem(id) {
  if (match.state.phase !== 'freeze') {
    audio.denied();
    return;
  }
  if (id === 'armor') {
    if (playerState.armor > 0 || !match.spend('player', ARMOR_PRICE)) {
      audio.denied();
      return;
    }
    playerState.armor = 100;
    hud.setHealth(playerState.hp, playerState.armor);
  } else {
    const def = WEAPONS[id];
    if (!def || playerState.primary === id || !match.spend('player', def.price)) {
      audio.denied();
      return;
    }
    playerState.primary = id;
    weapons.refill(id);
    weapons.equip(id);
  }
  audio.buy();
  hud.setMoney(match.getMoney('player'));
  hud.refreshBuy(match.getMoney('player'), ownedList());
}
hud.onBuy(buyItem);
hud.onBuyClose(() => {
  audio.click();
  closeBuy(true);
});

function scoreboardRows() {
  const rows = [{
    name: 'Fazz (you)', team: 'attack', kills: playerState.kills, deaths: playerState.deaths, money: match.getMoney('player'), me: true,
  }];
  for (const bot of manager.bots) {
    rows.push({ name: bot.name, team: bot.team, kills: bot.kills, deaths: bot.deaths, money: match.getMoney(bot.id), me: false });
  }
  rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  return rows;
}

// --- Player shooting.
const muzzle = new THREE.Vector3();
function shoot() {
  const def = weapons.def();
  if (!weapons.canFire()) return;
  if (!weapons.takeRound()) {
    audio.dryFire();
    if (weapons.reload()) audio.reload();
    return;
  }
  weapons.pullTrigger();
  lastPlayerShotAt = simTime;
  audio.shot(def.id, 0);
  manager.hearShot(player.state.position, true);
  markThreat(player.state.position);
  const spread = weapons.spread(player.groundSpeed(), !player.state.onGround, player.state.crouching, scoped);
  camera.getWorldDirection(tmpDir);
  weapons.muzzleWorld(muzzle);
  scene.updateMatrixWorld(true);
  let anyHit = false;
  let anyKill = false;
  for (let p = 0; p < def.pellets; p += 1) {
    const dir = tmpDir.clone();
    dir.x += (rng() * 2 - 1) * spread;
    dir.y += (rng() * 2 - 1) * spread;
    dir.z += (rng() * 2 - 1) * spread;
    dir.normalize();
    raycaster.set(camera.position, dir);
    raycaster.far = 90;
    const foes = manager.allHitMeshes().filter((m) => m.userData.bot.team === 'defend');
    const hit = raycaster.intersectObjects(world.shootables.concat(foes), false)[0];
    const end = hit ? hit.point : tmpPoint.copy(camera.position).addScaledVector(dir, 90);
    spawnTracer(muzzle, end, 0xffe0a8);
    if (!hit) continue;
    if (hit.object.userData.bot) {
      const victim = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const dmg = weapons.damageAt(hit.distance) * (part === 'head' ? def.headMul : part === 'legs' ? 0.8 : 1);
      const result = manager.damage(victim, dmg, part, playerCombatant);
      anyHit = true;
      anyKill = anyKill || result.killed;
      spawnImpact(hit.point, '#c94a4a', 0.3);
    } else {
      spawnImpact(hit.point, '#d9c39a', 0.36);
    }
  }
  if (anyHit) {
    hud.hitMarker(anyKill, anyKill ? 160 : 90);
    audio.hit(anyKill);
  }
  player.recoil(def.kick * (scoped ? 0.7 : 1) + rng() * 0.003, (rng() * 2 - 1) * def.kick * 0.4);
  trauma = Math.min(1, trauma + def.kick * 2.2);
  hud.setAmmo(weapons.state.mag[def.id], weapons.state.reserve[def.id], def.name, weapons.state.reloadLeft > 0);
}

// --- Spike sync + channels.
const spikeLampMat = spikeGroup.getObjectByName('spikeLamp').material;
function syncSpike() {
  const spike = match.state.spike;
  if (spike.state === 'player') {
    spikeGroup.visible = false;
    spikePos.copy(player.state.position);
    return;
  }
  if (spike.state === 'bot') {
    const carrier = manager.bots.find((b) => b.id === spike.carrierId);
    if (carrier && carrier.alive) {
      spikePos.set(carrier.group.position.x, 1.9, carrier.group.position.z);
      spikeGroup.position.copy(spikePos);
      spikeGroup.visible = true;
    } else {
      spikeGroup.visible = false;
    }
    return;
  }
  spikePos.copy(spike.position);
  spikePos.y = 0.15;
  spikeGroup.position.copy(spikePos);
  spikeGroup.visible = true;
  const planted = spike.state === 'planted';
  const rate = planted ? 9 : 2.2;
  const on = Math.sin(simTime * rate) > 0;
  spikeLampMat.color.set(on ? PALETTE.accent : '#4a3413');
}

function siteAt(pos) {
  for (const [site, data] of Object.entries(world.sites)) {
    const z = data.zone;
    if (pos.x >= z.minX && pos.x <= z.maxX && pos.z >= z.minZ && pos.z <= z.maxZ) return site;
  }
  return null;
}

function updatePlantChannel(dt, keys) {
  const phase = match.state.phase;
  if (plantChannel) {
    const moved = Math.hypot(player.state.position.x - plantChannel.startX, player.state.position.z - plantChannel.startZ);
    if (!keys.has('KeyE') || moved > 1.2 || phase !== 'live' || !playerState.alive) {
      plantChannel = null;
      hud.plantProgress(false, 0, '');
      return;
    }
    plantChannel.progress += dt;
    hud.plantProgress(true, plantChannel.progress / PLANT_TIME, `PLANTING THE SPIKE — SITE ${plantChannel.site}`);
    if (plantChannel.progress >= PLANT_TIME) {
      const site = plantChannel.site;
      plantChannel = null;
      hud.plantProgress(false, 0, '');
      match.plant(site, player.state.position);
    }
    return;
  }
  // Show a bot's channel, if any.
  for (const bot of manager.bots) {
    if (bot.alive && bot.channel) {
      const label = bot.channel.type === 'plant' ? `${bot.name.toUpperCase()} IS PLANTING THE SPIKE` : `${bot.name.toUpperCase()} IS DEFUSING`;
      hud.plantProgress(true, bot.channel.progress / bot.channel.duration, label);
      return;
    }
  }
  hud.plantProgress(false, 0, '');
}

function updatePickups() {
  if (match.state.phase !== 'live' || match.state.spike.state !== 'dropped') return;
  const pos = match.state.spike.position;
  if (playerState.alive && Math.hypot(player.state.position.x - pos.x, player.state.position.z - pos.z) < 1.3) {
    match.pickupSpike('player');
    hud.eventLine('Spike picked up — plant it at A or B.');
    hud.setSpike('carried');
    return;
  }
  for (const bot of manager.bots) {
    if (bot.team === 'attack' && bot.alive && Math.hypot(bot.group.position.x - pos.x, bot.group.position.z - pos.z) < 1.3) {
      if (match.pickupSpike(bot.id)) {
        bot.hasSpike = true;
        bot.path = [];
        bot.pathIndex = 0;
        bot.goalNode = null;
        hud.setSpike('none');
        hud.eventLine(`${bot.name} picked up the spike.`);
      }
      return;
    }
  }
}

// --- Camera.
let bobPhase = 0;
let lastWalked = 0;
function syncCamera() {
  const body = player.state;
  if (!playerState.alive) {
    camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
    camera.rotation.set(0.15, deathYaw, 0, 'YXZ');
    return;
  }
  const speed = player.groundSpeed();
  if (body.onGround) bobPhase += speed * 0.09;
  const bob = clamp(speed / 5.2, 0, 1) * (body.crouching ? 0.006 : 0.012);
  const shake = trauma * trauma;
  const shX = Math.sin(simTime * 61) * shake * 0.012;
  const shY = Math.cos(simTime * 53) * shake * 0.012;
  camera.position.set(body.position.x, body.position.y + body.eye + Math.sin(bobPhase * 2) * bob, body.position.z);
  camera.rotation.set(body.pitch + shX, body.yaw + shY, 0, 'YXZ');
  const targetFov = scoped ? 26 : aiming ? 58 : 74;
  fov = damp(fov, targetFov, 14, 1 / 60);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

// --- Fixed-step simulation.
let lookDelta = { x: 0, y: 0 };
function step(dt) {
  simTime += dt;
  trauma = Math.max(0, trauma - dt * 1.7);
  world.step(simTime);
  match.update(dt, aliveCounts());
  const keys = input.state.keys;
  const frozen = match.state.phase === 'freeze' || match.state.phase === 'idle' || match.state.phase === 'end';
  if (playerState.alive) player.step(dt, keys, frozen || match.state.phase === 'over');
  weapons.step(dt, player.groundSpeed(), lookDelta);
  lookDelta = { x: 0, y: 0 };
  manager.update(dt);
  updatePlantChannel(dt, keys);
  updatePickups();
  syncSpike();
  // Planted beeps accelerate toward detonation.
  if (match.state.phase === 'planted' && simTime >= nextBeepAt) {
    const urgency = 1 - match.state.timeLeft / SPIKE_TIME;
    audio.beep(urgency);
    nextBeepAt = simTime + (1 - urgency * 0.78);
  }
  // Effects.
  tracers.update(dt, (t) => {
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / t.max) * 0.9;
    t.line.visible = t.life > 0;
  });
  impacts.update(dt, (item) => {
    item.life -= dt;
    const f = Math.max(0, item.life / item.max);
    item.sprite.material.opacity = f * 0.85;
    item.sprite.scale.setScalar(item.size * (1.6 - f * 0.6));
    item.sprite.visible = item.life > 0;
  });
  flashes.update(dt, (item) => {
    item.life -= dt;
    item.sprite.material.opacity = Math.max(0, item.life / item.max);
    item.sprite.visible = item.life > 0;
  });
  if (explosion.life > 0) {
    explosion.life -= dt;
    const f = Math.max(0, explosion.life / explosion.max);
    explosion.sprite.material.opacity = f * 0.9;
    explosion.sprite.scale.setScalar(4 + (1 - f) * 14);
    explosion.light.intensity = f * 160;
    explosion.sprite.visible = explosion.life > 0;
    if (explosion.life <= 0) explosion.light.intensity = 0;
  }
  // Footsteps.
  const walked = player.state.walked;
  if (playerState.alive && player.state.onGround && walked - lastWalked > 2.3 && player.groundSpeed() > 1) {
    lastWalked = walked;
    const slow = keys.has('ShiftLeft') || keys.has('ShiftRight');
    audio.step(0, !slow);
  }
  // Expire minimap pings.
  pings = pings.filter((p) => p.until > simTime);
}

// --- Per-frame presentation.
let lastHudSecond = -1;
function present() {
  const phase = match.state.phase;
  if (phase === 'live' || phase === 'planted' || phase === 'freeze') {
    const seconds = Math.ceil(match.state.timeLeft);
    if (seconds !== lastHudSecond) {
      lastHudSecond = seconds;
      hud.setTimer(match.state.timeLeft, phase === 'planted' ? 'spike' : match.state.timeLeft < 15 && phase === 'live' ? 'urgent' : null);
    }
  }
  // Crosshair gap follows spread.
  const spread = weapons.spread(player.groundSpeed(), !player.state.onGround, player.state.crouching, scoped);
  hud.setCrosshairGap(clamp(5 + spread * 320, 5, 34));
  // Ammo readout (cheap: hud dedupes).
  const def = weapons.def();
  hud.setAmmo(weapons.state.mag[def.id], weapons.state.reserve[def.id], def.name, weapons.state.reloadLeft > 0);
  // Minimap.
  const fx = -Math.sin(player.state.yaw);
  const fz = -Math.cos(player.state.yaw);
  hud.drawMinimap(
    { x: player.state.position.x, z: player.state.position.z, forwardX: fx, forwardZ: fz },
    manager.bots.filter((b) => b.team === 'attack').map((b) => ({ alive: b.alive, position: b.group.position })),
    pings,
    spikeView.state === 'dropped' || spikeView.state === 'planted' ? { state: spikeView.state, position: spikePos } : null,
  );
}

let accumulator = 0;
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!paused && !frozenShot) {
    const look = input.takeLook();
    lookDelta = look;
    const sensitivity = scoped ? 0.001 : aiming ? 0.0016 : 0.0022;
    if (playerState.alive) player.look(look.x, look.y, sensitivity);
    aiming = input.state.aiming && playerState.alive;
    const wantScope = aiming && weapons.def().id === 'sniper' && weapons.state.reloadLeft === 0;
    if (wantScope !== scoped) {
      scoped = wantScope;
      hud.showScope(scoped);
    }
    // Edge-triggered keys.
    const pressed = input.takePressed();
    const phase = match.state.phase;
    if (pressed.has('KeyB')) {
      if (buyOpen) closeBuy(true);
      else if (phase === 'freeze' && playerState.alive) openBuy();
      else {
        audio.denied();
        hud.eventLine(phase === 'freeze' ? 'You must be alive to buy.' : 'Buy time is over — next round.');
      }
    }
    if (buyOpen) {
      const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
      const buyIds = ['rifle', 'smg', 'shotgun', 'sniper', 'armor'];
      for (let i = 0; i < buyKeys.length; i += 1) {
        if (pressed.has(buyKeys[i])) buyItem(buyIds[i]);
      }
    }
    if (pressed.has('KeyR') && playerState.alive && (phase === 'live' || phase === 'planted')) {
      if (weapons.reload()) audio.reload();
    }
    if (pressed.has('Digit1') && playerState.primary && !buyOpen) {
      if (weapons.equip(playerState.primary)) audio.click();
    }
    if (pressed.has('Digit2') && !buyOpen) {
      if (weapons.equip('pistol')) audio.click();
    }
    const wheel = input.takeWheel();
    if (wheel !== 0 && playerState.primary && !buyOpen) {
      const next = weapons.state.current === 'pistol' ? playerState.primary : 'pistol';
      if (weapons.equip(next)) audio.click();
    }
    if (pressed.has('KeyE') && !plantChannel && playerState.alive && phase === 'live' && match.state.spike.state === 'player') {
      const site = siteAt(player.state.position);
      if (site) {
        plantChannel = { site, progress: 0, startX: player.state.position.x, startZ: player.state.position.z };
      } else {
        hud.eventLine('The spike can only be planted at site A or B.');
      }
    }
    // Scoreboard while Tab is held.
    const showScores = input.state.keys.has('Tab');
    if (showScores !== scoreboardOpen) {
      scoreboardOpen = showScores;
      hud.showScoreboard(showScores, scoreboardRows());
    }
    // Firing.
    const firing = input.state.firing;
    const rising = firing && !prevFiring;
    prevFiring = firing;
    if (firing && playerState.alive && !buyOpen && (phase === 'live' || phase === 'planted')) {
      if (weapons.def().auto || rising) shoot();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    present();
  }
  renderer.render(scene, camera);
}
let scoreboardOpen = false;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Boot state: bots staged at spawn, match idle behind the start overlay.
{
  const weaponsMap = {};
  for (const bot of manager.bots) weaponsMap[bot.id] = 'rifle';
  manager.resetRound({ site: 'A', weapons: weaponsMap, spikeCarrier: null });
  hud.setScore(0, 0, 1, WIN_TARGET);
  hud.setMoney(START_MONEY);
  hud.setHealth(100, 0);
  hud.setAmmo(12, 48, 'P9 Sidearm', false);
  refreshAliveHud();
  syncCamera();
}

// --- Deterministic captures.
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    present();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozenShot = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.setHudVisible(true);
  if (name === 'start') {
    player.reset(0, 19, 0);
    settle(10);
    aimAt(new THREE.Vector3(0, 1.4, -8));
    hud.showOverlay('start');
    paintTwiceThenReady();
    return;
  }
  // The other captures run a scripted round.
  match.startMatch(['player', ...manager.bots.map((b) => b.id)]);
  if (name === 'buy') {
    player.reset(0, 20, 0);
    match.state.money.set('player', 4250);
    hud.setMoney(4250);
    settle(6);
    aimAt(new THREE.Vector3(2, 1.2, 8));
    openBuy();
    paintTwiceThenReady();
    return;
  }
  // play / end: jump straight into the live round.
  match.state.phase = 'live';
  match.state.timeLeft = 80;
  match.state.scores.attack = 2;
  match.state.scores.defend = 1;
  match.state.round = 4;
  match.state.money.set('player', 3250);
  playerState.primary = 'rifle';
  weapons.refill('rifle');
  weapons.equip('rifle');
  weapons.show();
  hud.setMoney(3250);
  hud.setScore(2, 1, 4, WIN_TARGET);
  if (name === 'end') {
    player.reset(0, 20, 0);
    settle(6);
    aimAt(new THREE.Vector3(0, 1.2, 6));
    hud.banner('ROUND WON', 'Enemy team eliminated.  VAN 3 — 1 SEN', 'win', 60000);
    hud.killfeed('Fazz', 'attack', 'Onyx', 'defend', 'K7', true, 3600000);
    hud.killfeed('Rook', 'attack', 'Bram', 'defend', 'K7', false, 3600000);
    paintTwiceThenReady();
    return;
  }
  // play: mid-lane firefight, staged deterministically. Equip first and let the
  // swap animation finish, then place the bots, aim and fire one round.
  player.reset(0, 5.5, 0);
  settle(20);
  const foes = manager.bots.filter((b) => b.team === 'defend');
  foes[0].group.position.set(1.5, 0, -2.5);
  foes[0].yaw = Math.PI;
  foes[0].targetYaw = Math.PI;
  foes[1].group.position.set(-2.5, 0, -4);
  foes[1].yaw = Math.PI - 0.3;
  foes[1].targetYaw = Math.PI - 0.3;
  const mate = manager.bots.find((b) => b.team === 'attack');
  mate.group.position.set(-3, 0, 1.5);
  mate.yaw = 0.15;
  mate.targetYaw = 0.15;
  aimAt(new THREE.Vector3(foes[0].group.position.x, 1.32, foes[0].group.position.z));
  shoot();
  settle(1);
  paintTwiceThenReady();
}

if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
