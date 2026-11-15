// The bots: seven AI combatants with distinct skill, roles and behaviour. They
// navigate a hand-placed waypoint graph (BFS paths), perceive enemies through
// distance, field of view and line-of-sight raycasts, fight in bursts with
// reaction delays and aim error, rotate on sound, and play the objective: the
// carrier plants the spike, defenders retake and defuse. Procedurally animated
// from boxes — legs swing, guns point where they look, the dead fall and sink.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';
import { angleDelta, clamp, randRange } from './util.js';

const EYE = 1.55;
const CHEST = 1.32;
const RADIUS = 0.34;
const PERCEIVE_EVERY = 0.12;
const SEE_DISTANCE = 46;
const FOV_COS = Math.cos(1.15);

const NAMES = {
  attack: ['Rook', 'Havoc', 'Mira'],
  defend: ['Onyx', 'Bram', 'Kestrel', 'Dagger'],
};

const BODY_COLORS = {
  attack: ['#7a5c38', '#6b5133', '#83683f'],
  defend: ['#3e4c56', '#46545f', '#39434d', '#4a5864'],
};

const shared = {};
function geoBox(w, h, d) {
  const key = `${w},${h},${d}`;
  if (!shared[key]) shared[key] = new THREE.BoxGeometry(w, h, d);
  return shared[key];
}

function buildBotMesh(team, colorIndex) {
  const bodyColor = BODY_COLORS[team][colorIndex % BODY_COLORS[team].length];
  const accent = team === 'attack' ? PALETTE.accent : PALETTE.accent2;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColor), roughness: 0.8, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.metalDark), roughness: 0.7, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accent), roughness: 0.4, metalness: 0.2, emissive: new THREE.Color(accent), emissiveIntensity: 0.35 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.75 });

  const group = new THREE.Group();
  const legL = new THREE.Mesh(geoBox(0.16, 0.78, 0.18), darkMat);
  legL.position.set(-0.11, 0.39, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(geoBox(0.52, 0.68, 0.3), bodyMat);
  torso.position.y = 1.12;
  const vest = new THREE.Mesh(geoBox(0.54, 0.4, 0.34), darkMat);
  vest.position.y = 1.16;
  const pack = new THREE.Mesh(geoBox(0.36, 0.44, 0.16), darkMat);
  pack.position.set(0, 1.18, 0.24);
  const head = new THREE.Mesh(geoBox(0.3, 0.32, 0.3), skinMat);
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(geoBox(0.34, 0.14, 0.34), team === 'defend' ? darkMat : bodyMat);
  helmet.position.y = 1.8;
  const visor = new THREE.Mesh(geoBox(0.24, 0.07, 0.03), accentMat);
  visor.position.set(0, 1.64, -0.16);
  const armL = new THREE.Mesh(geoBox(0.12, 0.12, 0.5), bodyMat);
  armL.position.set(-0.2, 1.3, -0.22);
  const armR = armL.clone();
  armR.position.x = 0.2;
  const gun = new THREE.Mesh(geoBox(0.07, 0.1, 0.62), darkMat);
  gun.position.set(0.14, 1.32, -0.42);
  const shoulderPad = new THREE.Mesh(geoBox(0.56, 0.1, 0.32), accentMat);
  shoulderPad.position.y = 1.47;
  group.add(legL, legR, torso, vest, pack, head, helmet, visor, armL, armR, gun, shoulderPad);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  // Hit volumes: slightly generous, separate from the visible mesh.
  const hitHead = new THREE.Mesh(geoBox(0.34, 0.36, 0.34), darkMat);
  hitHead.position.y = 1.62;
  hitHead.visible = false;
  const hitTorso = new THREE.Mesh(geoBox(0.56, 0.72, 0.36), darkMat);
  hitTorso.position.y = 1.12;
  hitTorso.visible = false;
  const hitLegs = new THREE.Mesh(geoBox(0.44, 0.78, 0.3), darkMat);
  hitLegs.position.y = 0.39;
  hitLegs.visible = false;
  group.add(hitHead, hitTorso, hitLegs);
  return { group, legL, legR, head, gun, hitMeshes: [hitHead, hitTorso, hitLegs], parts: ['head', 'torso', 'legs'] };
}

export function createBotManager(scene, world, hooks) {
  const bots = [];
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();

  for (const team of ['attack', 'defend']) {
    const count = team === 'attack' ? 3 : 4;
    for (let i = 0; i < count; i += 1) {
      const built = buildBotMesh(team, i);
      scene.add(built.group);
      const bot = {
        id: `${team[0]}${i}`,
        name: NAMES[team][i],
        team,
        role: 'entry',
        skill: 0.55 + hooks.random() * 0.4,
        hp: 100,
        alive: true,
        weaponId: 'rifle',
        group: built.group,
        legL: built.legL,
        legR: built.legR,
        headMesh: built.head,
        gunMesh: built.gun,
        hitMeshes: built.hitMeshes,
        yaw: 0,
        targetYaw: 0,
        path: [],
        pathIndex: 0,
        goalNode: null,
        state: 'hold',
        holdLook: 0,
        scanPhase: hooks.random() * Math.PI * 2,
        perceiveAt: hooks.random() * PERCEIVE_EVERY,
        visibleEnemy: null,
        lastKnown: null,
        lastKnownAt: -99,
        reactionAt: 0,
        burstLeft: 0,
        burstAt: 0,
        pauseUntil: 0,
        strafeDir: 1,
        strafeAt: 0,
        channel: null,
        hasSpike: false,
        assignedSite: 'A',
        stuckAt: 0,
        stuckPos: new THREE.Vector3(),
        walkPhase: 0,
        walked: 0,
        deathAt: 0,
        fall: 0,
        heardAt: -99,
        heardPos: null,
        kills: 0,
        deaths: 0,
      };
      built.hitMeshes.forEach((mesh, index) => {
        mesh.userData.bot = bot;
        mesh.userData.part = built.parts[index];
      });
      bots.push(bot);
    }
  }

  function allHitMeshes() {
    const out = [];
    for (const bot of bots) if (bot.alive) out.push(...bot.hitMeshes);
    return out;
  }

  function overlaps(x, z) {
    tmpV.set(x - RADIUS, 0.05, z - RADIUS);
    tmpV2.set(x + RADIUS, 1.7, z + RADIUS);
    const probe = new THREE.Box3(tmpV, tmpV2);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function setPath(bot, nodeIds) {
    bot.path = nodeIds.map((id) => world.nodes.get(id)).filter(Boolean);
    bot.pathIndex = 0;
    bot.goalNode = nodeIds[nodeIds.length - 1] ?? null;
  }

  function pathTo(bot, x, z) {
    const from = world.nearestNode(bot.group.position.x, bot.group.position.z);
    const to = world.nearestNode(x, z);
    setPath(bot, world.findPath(from.id, to.id));
    bot.path.push({ id: '__target', x, z });
  }

  function moveAlongPath(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = bot.path[bot.pathIndex];
    const dx = node.x - bot.group.position.x;
    const dz = node.z - bot.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.0) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const step = Math.min(dist, speed * dt);
    const nx = bot.group.position.x + (dx / dist) * step;
    const nz = bot.group.position.z + (dz / dist) * step;
    // Axis-separated slide, like the player.
    if (!overlaps(nx, bot.group.position.z)) bot.group.position.x = nx;
    if (!overlaps(bot.group.position.x, nz)) bot.group.position.z = nz;
    bot.targetYaw = Math.atan2(-dx, -dz);
    bot.walked += step;
    return false;
  }

  function eyePos(bot, out) {
    return out.set(bot.group.position.x, EYE, bot.group.position.z);
  }

  function chestPos(target, out) {
    if (target.isPlayer) {
      const p = hooks.getPlayer();
      return out.set(p.position.x, p.position.y + (p.crouching ? 1.0 : CHEST), p.position.z);
    }
    return out.set(target.group.position.x, CHEST, target.group.position.z);
  }

  function canSee(bot, target) {
    const from = eyePos(bot, new THREE.Vector3());
    const to = chestPos(target, new THREE.Vector3());
    const dist = from.distanceTo(to);
    if (dist > SEE_DISTANCE) return false;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    const facing = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
    const alerted = hooks.time - bot.lastKnownAt < 3 || hooks.time - bot.heardAt < 2 || dist < 6;
    if (facing < FOV_COS && !alerted) return false;
    return hooks.los(from, to);
  }

  function perceive(bot) {
    const enemies = hooks.getEnemies(bot);
    let best = null;
    let bestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const pos = enemy.isPlayer ? hooks.getPlayer().position : enemy.group.position;
      const dist = pos.distanceTo(bot.group.position);
      if (dist >= bestDist) continue;
      if (canSee(bot, enemy)) {
        best = enemy;
        bestDist = dist;
      }
    }
    if (best) {
      if (bot.visibleEnemy !== best) {
        bot.reactionAt = hooks.time + (0.55 - bot.skill * 0.25) * (best.isPlayer && hooks.playerFiredRecently() ? 0.7 : 1);
        bot.burstLeft = 0;
      }
      bot.visibleEnemy = best;
      bot.lastKnown = chestPos(best, new THREE.Vector3());
      bot.lastKnownAt = hooks.time;
    } else if (bot.visibleEnemy && hooks.time - bot.lastKnownAt > 0.6) {
      bot.visibleEnemy = null;
    }
  }

  function aimError(bot, target, dist) {
    const moving = bot.pathIndex < bot.path.length ? 0.012 : 0;
    const targetMoving = target.isPlayer ? hooks.playerSpeed() : 2;
    const base = 0.048 - bot.skill * 0.022;
    const settle = clamp((hooks.time - bot.reactionAt) * 0.5, 0, 1);
    return (base + moving + Math.min(0.02, targetMoving * 0.004)) * (1 - settle * 0.45) * (1 + dist / 60);
  }

  function fireAt(bot, target) {
    const def = WEAPONS[bot.weaponId];
    const origin = eyePos(bot, new THREE.Vector3());
    origin.y = CHEST + 0.05;
    const aim = chestPos(target, new THREE.Vector3());
    // Headshots: rare, deliberate for skilled bots at close range.
    const headshot = hooks.random() < 0.05 + bot.skill * 0.05;
    if (headshot) aim.y = target.isPlayer ? hooks.getPlayer().position.y + (hooks.getPlayer().crouching ? 1.05 : 1.62) : 1.62;
    const dist = origin.distanceTo(aim);
    const dir = aim.sub(origin).normalize();
    const err = aimError(bot, target, dist);
    const pellets = def.pellets;
    for (let p = 0; p < pellets; p += 1) {
      const d = dir.clone();
      d.x += (hooks.random() * 2 - 1) * err * (pellets > 1 ? 2.2 : 1);
      d.y += (hooks.random() * 2 - 1) * err * (pellets > 1 ? 2.2 : 1);
      d.z += (hooks.random() * 2 - 1) * err * (pellets > 1 ? 2.2 : 1);
      d.normalize();
      hooks.raycastShot(bot, origin, d, def, headshot);
    }
    hooks.onShoot(bot, origin);
  }

  function updateCombat(bot, dt) {
    const target = bot.visibleEnemy;
    if (!target || !target.alive) {
      bot.visibleEnemy = null;
      return false;
    }
    const to = chestPos(target, new THREE.Vector3());
    const from = bot.group.position;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    bot.targetYaw = Math.atan2(-dx, -dz);
    // Strafe perpendicular while fighting, changing direction periodically.
    if (hooks.time > bot.strafeAt) {
      bot.strafeDir = hooks.random() < 0.5 ? -1 : 1;
      bot.strafeAt = hooks.time + randRange(hooks.random, 0.7, 1.5);
    }
    const dist = Math.hypot(dx, dz);
    const wantDist = bot.weaponId === 'shotgun' ? 6 : bot.weaponId === 'sniper' ? 22 : 13;
    const speed = 2.4 + bot.skill * 0.8;
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    let mx = -fz * bot.strafeDir;
    let mz = fx * bot.strafeDir;
    if (dist > wantDist + 3) {
      mx += fx * 0.8;
      mz += fz * 0.8;
    } else if (dist < wantDist - 3) {
      mx -= fx * 0.7;
      mz -= fz * 0.7;
    }
    const len = Math.hypot(mx, mz) || 1;
    const nx = from.x + (mx / len) * speed * dt;
    const nz = from.z + (mz / len) * speed * dt;
    if (!overlaps(nx, from.z)) from.x = nx;
    if (!overlaps(from.x, nz)) from.z = nz;
    bot.walked += speed * dt * 0.6;

    if (hooks.time < bot.reactionAt || hooks.time < bot.pauseUntil) return true;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = bot.weaponId === 'sniper' ? 1 : 3 + Math.floor(hooks.random() * 2);
      bot.burstAt = hooks.time;
    }
    if (hooks.time >= bot.burstAt) {
      fireAt(bot, target);
      bot.burstLeft -= 1;
      bot.burstAt = hooks.time + WEAPONS[bot.weaponId].gap * (1.15 - bot.skill * 0.25);
      if (bot.burstLeft <= 0) bot.pauseUntil = hooks.time + randRange(hooks.random, 0.35, 0.8) * (1.15 - bot.skill * 0.3);
    }
    return true;
  }

  function decideObjective(bot) {
    const phase = hooks.getPhase();
    const spike = hooks.getSpike();
    if (phase === 'freeze' || phase === 'idle' || phase === 'end' || phase === 'over') {
      bot.state = 'hold';
      return;
    }
    if (bot.team === 'attack') {
      if (spike.state === 'planted') {
        // Guard the planted site from a nearby node.
        const guard = bot.assignedSite === 'A' ? ['A1', 'A3', 'D6', 'A2'] : ['B1', 'B3', 'D7', 'B2'];
        const node = guard[(bot.id.charCodeAt(1) + guard.length) % guard.length];
        if (bot.goalNode !== node) setPath(bot, world.findPath(world.nearestNode(bot.group.position.x, bot.group.position.z).id, node));
        bot.state = 'move';
        return;
      }
      if (bot.hasSpike) {
        const plantNode = bot.assignedSite === 'A' ? 'A2' : 'B2';
        const site = world.sites[bot.assignedSite];
        const inZone = bot.group.position.x >= site.zone.minX && bot.group.position.x <= site.zone.maxX
          && bot.group.position.z >= site.zone.minZ && bot.group.position.z <= site.zone.maxZ;
        if (inZone && !bot.visibleEnemy) {
          bot.state = 'plant';
          return;
        }
        if (bot.goalNode !== plantNode && bot.state !== 'plant') {
          setPath(bot, world.findPath(world.nearestNode(bot.group.position.x, bot.group.position.z).id, plantNode));
        }
        bot.state = 'move';
        return;
      }
      if (spike.state === 'dropped') {
        // Nearest living attacker fetches the dropped spike.
        const fetcher = hooks.nearestAttacker(spike.position);
        if (fetcher === bot) {
          pathTo(bot, spike.position.x, spike.position.z);
          bot.state = 'move';
          return;
        }
      }
      // Role paths.
      const site = bot.assignedSite;
      const lane = bot.role === 'lurker' ? (site === 'A' ? 'B' : 'A') : site;
      const dest = bot.role === 'entry' ? (lane === 'A' ? 'A1' : 'B1')
        : bot.role === 'lurker' ? (lane === 'A' ? 'A3' : 'B3')
        : (lane === 'A' ? 'A2' : 'B2');
      if (bot.goalNode !== dest && bot.pathIndex >= bot.path.length) {
        setPath(bot, world.findPath(world.nearestNode(bot.group.position.x, bot.group.position.z).id, dest));
      }
      // Hunt a fresh last-known position instead of idling.
      if (bot.pathIndex >= bot.path.length && hooks.time - bot.lastKnownAt < 4 && bot.lastKnown) {
        pathTo(bot, bot.lastKnown.x, bot.lastKnown.z);
      }
      bot.state = bot.pathIndex < bot.path.length ? 'move' : 'hold';
      return;
    }
    // Defenders.
    if (spike.state === 'planted') {
      const defuser = hooks.nearestDefender(spike.position);
      if (defuser === bot) {
        const d = Math.hypot(bot.group.position.x - spike.position.x, bot.group.position.z - spike.position.z);
        if (d < 1.7 && !bot.visibleEnemy) {
          bot.state = 'defuse';
          return;
        }
        pathTo(bot, spike.position.x, spike.position.z);
        bot.state = 'move';
        return;
      }
      const guard = spike.site === 'A' ? ['A1', 'E5', 'D3'] : ['B1', 'W5', 'D4'];
      const node = guard[bot.id.charCodeAt(1) % guard.length];
      if (bot.goalNode !== node && bot.pathIndex >= bot.path.length) {
        setPath(bot, world.findPath(world.nearestNode(bot.group.position.x, bot.group.position.z).id, node));
      }
      bot.state = 'move';
      return;
    }
    // Rotate toward a threatened site.
    const threat = hooks.getThreat();
    if (threat && bot.role !== 'anchor') {
      const node = threat === 'A' ? 'D3' : 'D4';
      if (bot.goalNode !== node && bot.pathIndex >= bot.path.length) {
        setPath(bot, world.findPath(world.nearestNode(bot.group.position.x, bot.group.position.z).id, node));
        bot.state = 'move';
        return;
      }
    }
    if (bot.pathIndex >= bot.path.length) {
      const hold = bot.holdNode;
      if (hold && bot.goalNode !== hold) {
        setPath(bot, world.findPath(world.nearestNode(bot.group.position.x, bot.group.position.z).id, hold));
      }
      bot.state = bot.pathIndex < bot.path.length ? 'move' : 'hold';
    } else {
      bot.state = 'move';
    }
  }

  function updateChannel(bot, dt) {
    if (!bot.channel) return;
    const ch = bot.channel;
    ch.progress += dt;
    if (bot.visibleEnemy) {
      bot.channel = null;
      bot.state = 'move';
      return;
    }
    if (ch.progress >= ch.duration) {
      bot.channel = null;
      if (ch.type === 'plant') hooks.onPlant(bot);
      else hooks.onDefuse(bot);
    }
  }

  function updateBot(bot, dt) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.35);
      bot.group.rotation.x = -bot.fall * 1.45;
      const since = hooks.time - bot.deathAt;
      if (since > 3.5) bot.group.position.y = -Math.min(1.4, (since - 3.5) * 0.8);
      if (since > 5.5) bot.group.visible = false;
      return;
    }
    bot.perceiveAt -= dt;
    const phaseNow = hooks.getPhase();
    const combatAllowed = phaseNow === 'live' || phaseNow === 'planted';
    if (bot.perceiveAt <= 0) {
      bot.perceiveAt = PERCEIVE_EVERY;
      if (combatAllowed) perceive(bot);
      else bot.visibleEnemy = null;
    }

    // Stuck detection: skip a node we cannot reach.
    const moved = Math.hypot(bot.group.position.x - bot.stuckPos.x, bot.group.position.z - bot.stuckPos.z);
    if (moved > 0.25) {
      bot.stuckPos.copy(bot.group.position);
      bot.stuckAt = hooks.time;
    } else if (hooks.time - bot.stuckAt > 1.6 && bot.pathIndex < bot.path.length) {
      bot.pathIndex += 1;
      bot.stuckAt = hooks.time;
      bot.stuckPos.copy(bot.group.position);
    }

    const fighting = updateCombat(bot, dt);
    if (!fighting) {
      if (bot.channel) updateChannel(bot, dt);
      else {
        decideObjective(bot);
        if (bot.state === 'move') {
          const speed = 4.3 + bot.skill * 0.7;
          moveAlongPath(bot, dt, speed);
        } else if (bot.state === 'hold') {
          // Scan the approach: slow sweeps around the hold direction.
          bot.targetYaw = bot.holdLook + Math.sin(hooks.time * 0.45 + bot.scanPhase) * 0.55;
        } else if (bot.state === 'plant') {
          bot.channel = { type: 'plant', progress: 0, duration: 3.5 };
          hooks.onChannelStart(bot, 'plant');
        } else if (bot.state === 'defuse') {
          bot.channel = { type: 'defuse', progress: 0, duration: 4 };
          hooks.onChannelStart(bot, 'defuse');
        }
      }
    }

    // Separation from nearby friendlies.
    for (const other of bots) {
      if (other === bot || !other.alive || other.team !== bot.team) continue;
      const dx = bot.group.position.x - other.group.position.x;
      const dz = bot.group.position.z - other.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.85) {
        const push = (0.85 - d) * 0.5;
        const nx = bot.group.position.x + (dx / d) * push * dt * 8;
        const nz = bot.group.position.z + (dz / d) * push * dt * 8;
        if (!overlaps(nx, bot.group.position.z)) bot.group.position.x = nx;
        if (!overlaps(bot.group.position.x, nz)) bot.group.position.z = nz;
      }
    }

    // Turn toward the target yaw at a limited rate.
    const turnRate = 4.5 + bot.skill * 3.5;
    const delta = angleDelta(bot.yaw, bot.targetYaw);
    bot.yaw += clamp(delta, -turnRate * dt, turnRate * dt);
    bot.group.rotation.y = bot.yaw;

    // Walk animation: legs swing with distance walked.
    const swing = Math.sin(bot.walked * 3.4) * 0.5;
    bot.legL.rotation.x = swing;
    bot.legR.rotation.x = -swing;
    // Footstep sounds for nearby bots.
    if (bot.walked - (bot.lastStepAt ?? 0) > 2.3) {
      bot.lastStepAt = bot.walked;
      hooks.onStep(bot);
    }
  }

  return {
    bots,
    allHitMeshes,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    resetRound(plan) {
      // plan: { site, weapons: {botId: weaponId}, spikeCarrier: bot|null }
      for (const bot of bots) {
        const spawn = world.spawns[bot.team === 'attack' ? 'attack' : 'defend'][bot.team === 'attack' ? (bots.indexOf(bot) + 1) % 4 : bots.indexOf(bot) - 3];
        bot.group.position.set(spawn.x, 0, spawn.z);
        bot.group.rotation.set(0, spawn.yaw, 0);
        bot.group.visible = true;
        bot.yaw = spawn.yaw;
        bot.targetYaw = spawn.yaw;
        bot.hp = 100;
        bot.alive = true;
        bot.fall = 0;
        bot.path = [];
        bot.pathIndex = 0;
        bot.goalNode = null;
        bot.state = 'hold';
        bot.visibleEnemy = null;
        bot.lastKnown = null;
        bot.lastKnownAt = -99;
        bot.channel = null;
        bot.hasSpike = plan.spikeCarrier === bot;
        bot.assignedSite = plan.site;
        bot.weaponId = plan.weapons[bot.id] ?? 'rifle';
        bot.stuckAt = hooks.time;
        bot.stuckPos.copy(bot.group.position);
        if (bot.team === 'attack') {
          bot.role = bot.id === 'a0' ? 'entry' : bot.id === 'a1' ? 'support' : 'lurker';
          bot.holdLook = 0;
        } else {
          const holds = { d0: 'D3', d1: 'D6', d2: 'D4', d3: 'D7' };
          bot.role = bot.id === 'd1' || bot.id === 'd3' ? 'anchor' : 'flex';
          bot.holdNode = holds[bot.id];
          bot.holdLook = bot.id === 'd0' ? Math.PI * 0.75 : bot.id === 'd1' ? Math.PI * 0.25 : bot.id === 'd2' ? -Math.PI * 0.75 : -Math.PI * 0.25;
        }
      }
    },
    update(dt) {
      for (const bot of bots) updateBot(bot, dt);
    },
    damage(bot, amount, part, attacker) {
      if (!bot.alive) return { killed: false, dealt: 0 };
      const dealt = Math.min(bot.hp, Math.round(amount));
      bot.hp -= dealt;
      // Being shot snaps attention toward the shooter.
      if (attacker) {
        const pos = attacker.isPlayer ? hooks.getPlayer().position : attacker.group.position;
        bot.lastKnown = new THREE.Vector3(pos.x, CHEST, pos.z);
        bot.lastKnownAt = hooks.time;
        bot.channel = null;
        if (!bot.visibleEnemy) bot.reactionAt = Math.min(bot.reactionAt || Infinity, hooks.time + 0.15);
      }
      if (bot.hp <= 0) {
        bot.alive = false;
        bot.deathAt = hooks.time;
        bot.deaths += 1;
        bot.channel = null;
        if (bot.hasSpike) {
          bot.hasSpike = false;
          hooks.onSpikeDropped(bot.group.position);
        }
        hooks.onKill(bot, attacker, part === 'head');
        return { killed: true, dealt };
      }
      return { killed: false, dealt };
    },
    hearShot(pos, loud) {
      for (const bot of bots) {
        if (!bot.alive) continue;
        const d = bot.group.position.distanceTo(pos);
        if (d < (loud ? 34 : 22)) {
          bot.heardAt = hooks.time;
          bot.heardPos = pos.clone();
          if (!bot.visibleEnemy && hooks.time - bot.lastKnownAt > 5) {
            bot.lastKnown = new THREE.Vector3(pos.x, CHEST, pos.z);
            bot.lastKnownAt = hooks.time;
          }
        }
      }
    },
    nearestAlive(team, pos) {
      let best = null;
      let bestDist = Infinity;
      for (const bot of bots) {
        if (bot.team !== team || !bot.alive) continue;
        const d = bot.group.position.distanceTo(pos);
        if (d < bestDist) {
          bestDist = d;
          best = bot;
        }
      }
      return best;
    },
  };
}
