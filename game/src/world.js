// EMBERLINE's map: "Relay Station Kestrel", a desert outpost with three lanes.
// Attackers (Vanguard, amber) spawn south; defenders (Sentinels, teal) spawn north.
// Site A (east) holds the relay tower, site B (west) the fuel tanks. Mid runs through
// a walled arch; the relay house blocks the direct north route, forcing rotations.
// Every solid is a box collider and a bullet stop. A hand-placed waypoint graph drives
// the bots; every edge was checked clear of the solids it crosses.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeTextures } from './textures.js';

const BOUNDS = { minX: -30, maxX: 30, minZ: -24, maxZ: 24 };

const NODES = {
  S0: [0, 20], E1: [11, 16], M1: [0, 14], W1: [-11, 16],
  E2: [11, 8], E3: [11, 0], E4: [11, -6], E5: [13, -10],
  A0: [20, -6], A1: [18, -11], A2: [22, -14], A3: [25, -11], D6: [18, -16],
  W2: [-11, 8], W3: [-11, 0], W4: [-11, -6], W5: [-13, -10],
  B0: [-20, -6], B1: [-18, -11], B2: [-22, -14], B3: [-25, -11], D7: [-18, -16],
  M2: [0, 8], M3: [0, 2], M4: [-3.2, -2], M5: [3.2, -2], M6: [0, -6],
  C1: [-8, -6.5], C2: [8, -6.5], G1: [8, 7.5], G2: [-8, 7.5],
  D0: [0, -20], D1: [10, -16], D2: [-10, -16], D3: [11, -13], D4: [-11, -13],
  D5: [0, -18], H1: [-9.5, -13], H2: [9.5, -13],
};

const EDGES = [
  ['S0', 'M1'], ['S0', 'E1'], ['S0', 'W1'], ['M1', 'E1'], ['M1', 'W1'],
  ['M1', 'M2'], ['M2', 'M3'], ['M3', 'M4'], ['M3', 'M5'], ['M4', 'M6'], ['M5', 'M6'],
  ['M6', 'C1'], ['M6', 'C2'], ['C1', 'W4'], ['C2', 'E4'],
  ['E1', 'E2'], ['E2', 'E3'], ['E3', 'E4'], ['E4', 'E5'], ['E5', 'A1'],
  ['E4', 'A0'], ['A0', 'A1'], ['A1', 'A2'], ['A1', 'A3'], ['A2', 'A3'], ['A2', 'D6'], ['A1', 'D6'],
  ['W1', 'W2'], ['W2', 'W3'], ['W3', 'W4'], ['W4', 'W5'], ['W5', 'B1'],
  ['W4', 'B0'], ['B0', 'B1'], ['B1', 'B2'], ['B1', 'B3'], ['B2', 'B3'], ['B2', 'D7'], ['B1', 'D7'],
  ['E2', 'G1'], ['G1', 'M2'], ['W2', 'G2'], ['G2', 'M2'],
  ['D0', 'D1'], ['D0', 'D2'], ['D0', 'D5'], ['D1', 'D5'], ['D2', 'D5'],
  ['D1', 'D3'], ['D2', 'D4'], ['D3', 'E5'], ['D4', 'W5'],
  ['D1', 'H2'], ['H2', 'C2'], ['D2', 'H1'], ['H1', 'C1'],
];

export function createWorld(scene) {
  const textures = makeTextures();
  textures.ground.repeat.set(14, 14);
  const group = new THREE.Group();
  scene.add(group);

  const mat = {
    ground: new THREE.MeshStandardMaterial({ map: textures.ground, roughness: 0.96, metalness: 0 }),
    sand: new THREE.MeshStandardMaterial({ map: textures.sand, roughness: 0.95, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ map: textures.concrete, roughness: 0.9, metalness: 0.02 }),
    concreteDark: new THREE.MeshStandardMaterial({ map: textures.concreteDark, roughness: 0.92, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ map: textures.metal, roughness: 0.55, metalness: 0.55 }),
    metalDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.metalDark), roughness: 0.6, metalness: 0.5 }),
    crate: new THREE.MeshStandardMaterial({ map: textures.crate, roughness: 0.85, metalness: 0 }),
    rust: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.7, metalness: 0.3 }),
    hazard: new THREE.MeshStandardMaterial({ map: textures.hazard, roughness: 0.8, metalness: 0.1 }),
    mesa: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sandDark), roughness: 1, metalness: 0 }),
    mesaTop: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.concreteDark), roughness: 1, metalness: 0 }),
    amber: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.25 }),
    teal: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent2), roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(PALETTE.accent2), emissiveIntensity: 0.25 }),
  };

  const colliders = [];
  const shootables = [];
  const wallRects = [];
  const animated = [];

  function register(mesh, solid, minimap) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      mesh.updateMatrixWorld(true);
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    if (minimap) {
      const size = new THREE.Vector3();
      new THREE.Box3().setFromObject(mesh).getSize(size);
      wallRects.push({ x: mesh.position.x, z: mesh.position.z, w: Math.max(size.x, 0.4), d: Math.max(size.z, 0.4) });
    }
    return mesh;
  }

  function box(w, h, d, x, y, z, material, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    return register(mesh, opts.solid !== false, opts.minimap !== false);
  }

  function cyl(rt, rb, h, x, y, z, material, segments = 14) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segments), material);
    mesh.position.set(x, y, z);
    return register(mesh, true, true);
  }

  // --- Ground: endless desert + a packed-earth playfield.
  const desert = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat.ground);
  desert.rotation.x = -Math.PI / 2;
  desert.position.y = -0.02;
  desert.receiveShadow = true;
  group.add(desert);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(60.6, 48.6), mat.sand);
  field.rotation.x = -Math.PI / 2;
  field.position.y = 0.01;
  field.receiveShadow = true;
  group.add(field);

  // --- Sky dome and distant mesas.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(170, 24, 14),
    new THREE.MeshBasicMaterial({ map: textures.sky, side: THREE.BackSide, fog: false }),
  );
  group.add(sky);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
  sunGlow.position.set(90, 46, 60);
  sunGlow.scale.set(46, 46, 1);
  group.add(sunGlow);
  for (const [x, z, w, h, d] of [[-72, -50, 34, 22, 18], [64, -70, 44, 30, 20], [86, 30, 30, 16, 22], [-88, 40, 38, 20, 16], [30, -95, 50, 26, 18], [-40, 85, 46, 18, 20], [95, -30, 26, 13, 16]]) {
    const mesa = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat.mesa);
    mesa.position.set(x, h / 2 - 1, z);
    group.add(mesa);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 1.5, 1.6, d + 1.5), mat.mesaTop);
    cap.position.set(x, h - 1.4, z);
    group.add(cap);
  }

  // --- Perimeter walls.
  const WALL_H = 4.2;
  const T = 0.6;
  box(61.2, WALL_H, T, 0, WALL_H / 2, -24.3, mat.concreteDark);
  box(61.2, WALL_H, T, 0, WALL_H / 2, 24.3, mat.concreteDark);
  box(T, WALL_H, 49.2, -30.3, WALL_H / 2, 0, mat.concreteDark);
  box(T, WALL_H, 49.2, 30.3, WALL_H / 2, 0, mat.concreteDark);
  // Corner watch towers.
  for (const [x, z] of [[-28.4, -22.4], [28.4, -22.4], [-28.4, 22.4], [28.4, 22.4]]) {
    box(2.2, 3.4, 2.2, x, 1.7, z, mat.concrete);
    box(3.0, 0.3, 3.0, x, 3.55, z, mat.metalDark);
    box(2.4, 1.0, 2.4, x, 4.2, z, mat.concreteDark, { solid: false, minimap: false });
    box(3.2, 0.25, 3.2, x, 4.85, z, mat.metalDark, { solid: false, minimap: false });
  }

  // --- Mid arch wall (z = 0): two gaps.
  box(3.4, 3.4, T, -6.6, 1.7, 0, mat.concrete);
  box(2.4, 3.4, T, 0, 1.7, 0, mat.concrete);
  box(3.4, 3.4, T, 6.6, 1.7, 0, mat.concrete);
  box(17.2, 0.5, 0.9, 0, 3.65, 0, mat.concreteDark, { solid: false, minimap: false });

  // --- Lane dividers with connector gaps.
  for (const sx of [-1, 1]) {
    box(T, 3.4, 4.4, sx * 8, 1.7, 4, mat.concrete); // z 1.8..6.2
    box(T, 3.4, 5.4, sx * 8, 1.7, 11.5, mat.concrete); // z 8.8..14.2
    box(T, 3.4, 6.4, sx * 8, 1.7, -11, mat.concrete); // z -14.2..-7.8
    box(T, 3.4, 3.4, sx * 8, 1.7, -3.4, mat.concrete); // z -5.1..-1.7
  }

  // --- Relay house: the central block.
  box(12.4, 4.6, 4.4, 0, 2.3, -13, mat.concrete);
  box(13.0, 0.4, 5.0, 0, 4.8, -13, mat.metalDark, { solid: false, minimap: false });
  box(2.2, 1.4, 0.5, -3.4, 3.6, -10.7, mat.metalDark, { solid: false, minimap: false });
  box(2.2, 1.4, 0.5, 3.4, 3.6, -10.7, mat.metalDark, { solid: false, minimap: false });
  // Antenna mast + blinking beacon on the roof.
  cyl(0.09, 0.12, 4.5, 0, 7.2, -13, mat.metalDark, 8);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) }));
  beacon.position.set(0, 9.6, -13);
  group.add(beacon);
  const beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: new THREE.Color(PALETTE.danger), transparent: true, opacity: 0.7, depthWrite: false }));
  beaconGlow.position.copy(beacon.position);
  beaconGlow.scale.set(2.2, 2.2, 1);
  group.add(beaconGlow);
  animated.push((t) => {
    const on = Math.sin(t * 2.4) > 0.2;
    beaconGlow.material.opacity = on ? 0.75 : 0.08;
    beacon.material.color.set(on ? PALETTE.danger : '#57191b');
  });

  // --- Site walls: A (east) and B (west), each with two entries.
  for (const sx of [-1, 1]) {
    const xw = sx * 14;
    box(T, 3.4, 8.4, xw, 1.7, -16, mat.concrete); // z -20.2..-11.8
    box(T, 3.4, 1.4, xw, 1.7, -8.6, mat.concrete); // z -9.3..-7.9
    box(4.4, 3.4, T, sx * 16.2, 1.7, -8, mat.concrete); // x 14..18.4
    box(6.4, 3.4, T, sx * 25, 1.7, -8, mat.concrete); // x 21.8..28.2
  }

  // --- Crates, sandbags, barrels.
  const CRATE = 1.15;
  function crate(x, z, stack = 1, rotY = 0) {
    for (let i = 0; i < stack; i += 1) box(CRATE, CRATE, CRATE, x, CRATE / 2 + i * CRATE, z, mat.crate, { rotY: rotY + (i % 2 ? 0.06 : 0) });
  }
  crate(2.5, 5.5, 1, 0.1);
  crate(-2.5, 5.5, 1, -0.08);
  crate(0, -3.5, 2, 0.04);
  crate(4.5, -6.5, 1, 0.12);
  crate(-4.5, -6.5, 1, -0.1);
  crate(12.8, 3.5, 1, 0.06);
  crate(9.6, 10.5, 1, -0.05);
  crate(12.8, -3.5, 2, 0.02);
  crate(9.8, -7.5, 1, 0.09);
  crate(-12.8, 3.5, 1, -0.06);
  crate(-9.6, 10.5, 1, 0.05);
  crate(-12.8, -3.5, 2, -0.02);
  crate(-9.8, -7.5, 1, -0.09);
  crate(17.5, -13.5, 1, 0.07);
  crate(23.5, -11.5, 2, -0.04);
  crate(25.5, -16.5, 1, 0.1);
  crate(19.5, -17.5, 1, -0.06);
  crate(21, -10.5, 1, 0.03);
  crate(-17.5, -13.5, 1, -0.07);
  crate(-23.5, -11.5, 2, 0.04);
  crate(-25.5, -16.5, 1, -0.1);
  crate(-19.5, -17.5, 1, 0.06);
  crate(-21, -10.5, 1, -0.03);
  crate(6.5, 15.5, 1, 0.08);
  crate(-6.5, 15.5, 1, -0.08);
  crate(7, -18.5, 1, 0.05);
  crate(-7, -18.5, 1, -0.05);

  function sandbags(x, z, rotY) {
    for (let i = 0; i < 3; i += 1) {
      const off = (i - 1) * 0.85;
      box(0.8, 0.5, 0.6, x + Math.cos(rotY) * off, 0.25, z + Math.sin(rotY) * off, mat.sand, { rotY });
    }
    for (let i = 0; i < 2; i += 1) {
      const off = (i - 0.5) * 0.85;
      box(0.8, 0.5, 0.6, x + Math.cos(rotY) * off, 0.72, z + Math.sin(rotY) * off, mat.sand, { rotY });
    }
  }
  sandbags(0, -16.8, 0);
  sandbags(15.5, -12.5, Math.PI / 2);
  sandbags(-15.5, -12.5, Math.PI / 2);
  sandbags(3.2, 11.5, 0.4);
  sandbags(-3.2, 11.5, -0.4);

  function barrel(x, z, material) {
    cyl(0.42, 0.42, 1.05, x, 0.53, z, material, 12);
  }
  barrel(14.5, 8, mat.rust);
  barrel(15.4, 8.6, mat.metal);
  barrel(-14.5, 8, mat.metal);
  barrel(-15.4, 8.6, mat.rust);
  barrel(26, -8.5, mat.rust);
  barrel(-26, -8.5, mat.metal);
  barrel(5, 18.5, mat.metal);
  barrel(-5, 18.5, mat.rust);
  barrel(27, -19, mat.metal);
  barrel(-27, -19, mat.rust);

  // Scattered rocks near the outer walls.
  const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
  for (const [x, z, s] of [[28, 0, 1.2], [-28, 4, 1.5], [28, 14, 0.9], [-28, -4, 1.1], [20, 22, 1.3], [-20, 22, 1.0], [24, 18, 0.8], [-24, 18, 1.2]]) {
    const rock = new THREE.Mesh(rockGeo, mat.mesaTop);
    rock.position.set(x, 0.3 * s, z);
    rock.scale.setScalar(s);
    rock.rotation.set(Math.random(), Math.random() * 3, Math.random());
    register(rock, true, true);
  }

  // --- Site A: the relay tower.
  const towerX = 21;
  const towerZ = -14;
  for (const [dx, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 5.4, 0.22), mat.metalDark);
    leg.position.set(towerX + dx, 2.7, towerZ + dz);
    leg.rotation.z = -dx * 0.06;
    leg.rotation.x = dz * 0.06;
    register(leg, false, false);
  }
  box(3.1, 0.25, 3.1, towerX, 5.5, towerZ, mat.metal, { solid: false, minimap: false });
  cyl(0.12, 0.16, 3.6, towerX, 7.4, towerZ, mat.metalDark, 8);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), mat.metal);
  dish.position.set(towerX, 6.4, towerZ);
  dish.rotation.x = -0.9;
  dish.rotation.z = 0.5;
  group.add(dish);
  animated.push((t) => {
    dish.rotation.y = Math.sin(t * 0.35) * 0.35;
  });
  box(2.6, 1.2, 2.6, towerX, 0.6, towerZ, mat.metalDark); // base cabinet (collider)
  // Amber site lamp.
  const lampA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 20, 1.8);
  lampA.position.set(towerX, 4.4, towerZ);
  group.add(lampA);

  // --- Site B: fuel tanks.
  for (const [x, z] of [[-21, -14], [-24.6, -16.8]]) {
    cyl(1.7, 1.7, 3.3, x, 1.65, z, mat.metal, 20);
    cyl(1.75, 1.75, 0.25, x, 3.4, z, mat.metalDark, 20);
    cyl(0.16, 0.16, 1.0, x, 3.9, z, mat.rust, 8);
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.4, 8), mat.rust);
  pipe.position.set(-22.8, 0.7, -15.4);
  pipe.rotation.z = Math.PI / 2;
  pipe.rotation.y = 0.6;
  register(pipe, false, false);
  const lampB = new THREE.PointLight(new THREE.Color(PALETTE.accent2), 26, 20, 1.8);
  lampB.position.set(-21, 4.4, -14);
  group.add(lampB);

  // --- Site decals: painted letters + hazard strips at the entries.
  function siteDecal(letter, color, x, z) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({ map: textures.siteLetter(letter, color), transparent: true, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, 0.04, z);
    group.add(decal);
  }
  siteDecal('A', '#f0a830', 22, -14);
  siteDecal('B', '#35c4b5', -22, -14);
  for (const [x, z, rotY] of [[20, -7.6, 0], [-20, -7.6, 0], [13.6, -10.5, Math.PI / 2], [-13.6, -10.5, Math.PI / 2]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.7), mat.hazard);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = rotY;
    strip.position.set(x, 0.04, z);
    group.add(strip);
  }

  // --- Light: low warm sun, cool dusk fill, sky/ground bounce.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#f2c491'), new THREE.Color('#8a6a48'), 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd9a8'), 2.4);
  sun.position.set(34, 42, 26);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#8a7aa8'), 0.5);
  fill.position.set(-26, 22, -24);
  scene.add(fill);

  // --- Waypoint graph.
  const nodes = new Map(Object.entries(NODES).map(([id, [x, z]]) => [id, { id, x, z }]));
  const adjacency = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const [a, b] of EDGES) {
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  function nearestNode(x, z) {
    let best = null;
    let bestDist = Infinity;
    for (const node of nodes.values()) {
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  function findPath(fromId, toId) {
    if (fromId === toId) return [fromId];
    const prev = new Map([[fromId, null]]);
    const queue = [fromId];
    while (queue.length) {
      const current = queue.shift();
      for (const next of adjacency.get(current) ?? []) {
        if (prev.has(next)) continue;
        prev.set(next, current);
        if (next === toId) {
          const path = [toId];
          let step = toId;
          while (prev.get(step)) {
            step = prev.get(step);
            path.unshift(step);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [fromId, toId];
  }

  return {
    colliders,
    shootables,
    group,
    bounds: BOUNDS,
    wallRects,
    nodes,
    adjacency,
    nearestNode,
    findPath,
    sites: {
      A: { zone: { minX: 16, maxX: 26, minZ: -18, maxZ: -10 }, plant: { x: 22, z: -14 }, letter: 'A' },
      B: { zone: { minX: -26, maxX: -16, minZ: -18, maxZ: -10 }, plant: { x: -22, z: -14 }, letter: 'B' },
    },
    spawns: {
      attack: [
        { x: 0, z: 20, yaw: 0 },
        { x: -2.4, z: 21, yaw: 0 },
        { x: 2.4, z: 21, yaw: 0 },
        { x: 0, z: 22.2, yaw: 0 },
      ],
      defend: [
        { x: 0, z: -20, yaw: Math.PI },
        { x: -2.4, z: -21, yaw: Math.PI },
        { x: 2.4, z: -21, yaw: Math.PI },
        { x: 0, z: -22.2, yaw: Math.PI },
      ],
    },
    step(t) {
      for (const fn of animated) fn(t);
    },
  };
}
