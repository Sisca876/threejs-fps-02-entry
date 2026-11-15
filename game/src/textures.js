// Every texture is painted at runtime on an offscreen canvas: no image files, no
// network requests. Sand, concrete, metal, wood crates, hazard stripes, site letters
// and the dusk sky gradient are all generated here, seeded so captures are stable.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './util.js';

function canvasTexture(size, painter, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  painter(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function speckle(ctx, size, random, colors, count, maxR) {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    const r = 0.6 + random() * maxR;
    ctx.beginPath();
    ctx.arc(random() * size, random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}

export function makeTextures() {
  const random = mulberry32(1337);

  const sand = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, random, [shade(PALETTE.sand, -22), shade(PALETTE.sand, 18), shade(PALETTE.sandDark, 8)], 2600, 1.8);
    // Wind ripples: faint horizontal bands.
    ctx.globalAlpha = 0.08;
    for (let y = 0; y < s; y += 7) {
      ctx.fillStyle = y % 14 === 0 ? '#ffffff' : '#5a4326';
      ctx.fillRect(0, y, s, 2);
    }
    ctx.globalAlpha = 1;
    // A few pebbles.
    for (let i = 0; i < 26; i += 1) {
      ctx.fillStyle = shade(PALETTE.sandDark, -18);
      ctx.beginPath();
      ctx.ellipse(random() * s, random() * s, 2 + random() * 3, 1.5 + random() * 2, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 10, 10);

  const ground = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, random, [shade(PALETTE.sand, -26), shade(PALETTE.sand, 16), shade(PALETTE.sandDark, 4)], 5200, 2.2);
    // Cracks.
    ctx.strokeStyle = shade(PALETTE.sandDark, -24);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 14; i += 1) {
      let x = random() * s;
      let y = random() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j += 1) {
        x += (random() - 0.5) * 46;
        y += (random() - 0.5) * 46;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Tyre tracks: two dark parallel ruts.
    ctx.strokeStyle = shade(PALETTE.sandDark, -30);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.3);
    ctx.bezierCurveTo(s * 0.3, s * 0.22, s * 0.6, s * 0.42, s, s * 0.34);
    ctx.moveTo(0, s * 0.38);
    ctx.bezierCurveTo(s * 0.3, s * 0.3, s * 0.6, s * 0.5, s, s * 0.42);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, 4, 4);

  const concrete = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.concrete;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, random, [shade(PALETTE.concrete, -20), shade(PALETTE.concrete, 14)], 2000, 1.6);
    // Panel seams.
    ctx.strokeStyle = shade(PALETTE.concreteDark, -8);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
    // Weather stains dripping from the top.
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 9; i += 1) {
      const x = random() * s;
      const w = 6 + random() * 16;
      const grad = ctx.createLinearGradient(0, 0, 0, s * 0.7);
      grad.addColorStop(0, '#4a3b28');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, w, s * 0.7);
    }
    ctx.globalAlpha = 1;
  }, 2, 1);

  const concreteDark = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.concreteDark;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, random, [shade(PALETTE.concreteDark, -16), shade(PALETTE.concreteDark, 12)], 1800, 1.6);
    ctx.strokeStyle = shade(PALETTE.concreteDark, -22);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  }, 2, 1);

  const metal = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.metal;
    ctx.fillRect(0, 0, s, s);
    // Brushed vertical lines.
    for (let x = 0; x < s; x += 3) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + random() * 0.05})`;
      ctx.fillRect(x, 0, 1, s);
      ctx.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.05})`;
      ctx.fillRect(x + 1, 0, 1, s);
    }
    // Rivets along the edges.
    ctx.fillStyle = shade(PALETTE.metalDark, -10);
    for (let i = 0; i < 8; i += 1) {
      const x = 10 + i * 34;
      ctx.beginPath();
      ctx.arc(x, 10, 3.4, 0, Math.PI * 2);
      ctx.arc(x, s - 10, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Rust patches.
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 12; i += 1) {
      ctx.fillStyle = PALETTE.rust;
      ctx.beginPath();
      ctx.ellipse(random() * s, random() * s, 6 + random() * 16, 4 + random() * 9, random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, 1, 1);

  const crate = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.crate;
    ctx.fillRect(0, 0, s, s);
    // Planks.
    for (let y = 0; y < s; y += 42) {
      ctx.fillStyle = shade(PALETTE.crate, y % 84 === 0 ? -14 : 10);
      ctx.fillRect(0, y, s, 40);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y + 40, s, 2);
      // Wood grain.
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 5; g += 1) {
        const gy = y + 6 + random() * 30;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(s * 0.3, gy + 3, s * 0.6, gy - 3, s, gy + 1);
        ctx.stroke();
      }
    }
    // Frame and corner bolts.
    ctx.strokeStyle = shade(PALETTE.crateDark, -12);
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, s - 10, s - 10);
    ctx.fillStyle = shade(PALETTE.crateDark, -20);
    for (const [x, y] of [[18, 18], [s - 18, 18], [18, s - 18], [s - 18, s - 18]]) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 1, 1);

  const hazard = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#1c1a16';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = PALETTE.accent;
    ctx.beginPath();
    for (let x = -s; x < s * 2; x += 32) {
      ctx.moveTo(x, s);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 16, s);
    }
    ctx.fill();
  }, 3, 1);

  const sky = canvasTexture(64, (ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#7a6a9a');
    grad.addColorStop(0.45, '#c98a6d');
    grad.addColorStop(0.72, PALETTE.sky);
    grad.addColorStop(1, '#f2c491');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });

  function siteLetter(letter, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(14, 14, 228, 228);
    ctx.fillStyle = color;
    ctx.font = '700 150px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 128, 134);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const glow = canvasTexture(64, (ctx, s) => {
    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });

  return { sand, ground, concrete, concreteDark, metal, crate, hazard, sky, glow, siteLetter };
}
