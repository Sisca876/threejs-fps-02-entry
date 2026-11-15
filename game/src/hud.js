// The DOM HUD: crosshair, hit marker, health/armor, ammo, money, timer, scores,
// kill feed, banners, buy menu, scoreboard, plant progress, damage direction and
// the canvas minimap. It never touches the simulation; main.js pushes numbers in
// and reads the buy/play callbacks out.
import { WEAPONS, ARMOR_PRICE, ARMOR_NAME } from './weapons.js';
import { formatMoney, formatTime } from './util.js';

const COPY = {
  start: {
    title: 'EMBER<em>LINE</em>',
    copy: 'You are <b>Fazz</b> of the Vanguard. Plant the spike at site <b>A</b> or <b>B</b>, or eliminate the Sentinels. Win rounds to earn money, spend it on better guns. First team to <b>5 rounds</b> takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBER<em>LINE</em>',
    copy: 'Paused. The round waits for you — click to jump back in.',
    action: 'Click to resume',
  },
  end: {
    title: 'MATCH <em>OVER</em>',
    copy: '',
    action: 'Play again',
  },
};

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const els = {
    hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    damageDir: $('damage-dir'), vignette: $('vignette'), scope: $('scope'),
    timer: $('timer'), roundLabel: $('round-label'), scoreVan: $('score-van'), scoreSen: $('score-sen'),
    alive: $('alive'), spikeStatus: $('spike-status'), killfeed: $('killfeed'),
    healthNum: $('health-num'), healthBar: $('health-bar'), armorBar: $('armor-bar'), armorNum: $('armor-num'),
    weaponName: $('weapon-name'), ammoWrap: $('ammo-wrap'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    money: $('money'), eventLine: $('event-line'), banner: $('banner'), bannerText: $('banner-text'), bannerSub: $('banner-sub'),
    plantWrap: $('plant-wrap'), plantLabel: $('plant-label'), plantBar: $('plant-bar'),
    buymenu: $('buymenu'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'), buyClose: $('buy-close'),
    scoreboard: $('scoreboard'), scoreRows: $('score-rows'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'), play: $('play'),
    minimap: $('minimap'),
  };
  let hitTimer = 0;
  let bannerTimer = 0;
  let eventTimer = 0;
  let damageTimer = 0;
  let hurtTimer = 0;
  let lastAmmo = '';
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let buyHandler = null;

  // --- Minimap: static layer painted once, dynamic layer per frame.
  const mm = els.minimap.getContext('2d');
  const MM_W = els.minimap.width;
  const MM_H = els.minimap.height;
  const staticLayer = document.createElement('canvas');
  staticLayer.width = MM_W;
  staticLayer.height = MM_H;
  {
    const c = staticLayer.getContext('2d');
    const b = world.bounds;
    const sx = MM_W / (b.maxX - b.minX);
    const sz = MM_H / (b.maxZ - b.minZ);
    const X = (x) => (x - b.minX) * sx;
    const Z = (z) => (z - b.minZ) * sz;
    c.fillStyle = '#241d15';
    c.fillRect(0, 0, MM_W, MM_H);
    c.fillStyle = '#3a3126';
    for (const r of world.wallRects) c.fillRect(X(r.x - r.w / 2), Z(r.z - r.d / 2), r.w * sx, r.d * sz);
    c.strokeStyle = '#55472f';
    c.lineWidth = 2;
    c.strokeRect(1, 1, MM_W - 2, MM_H - 2);
    c.font = '700 26px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#f0a830';
    c.fillText('A', X(22), Z(-14));
    c.fillStyle = '#35c4b5';
    c.fillText('B', X(-22), Z(-14));
  }
  function drawMinimap(player, teammates, pings, spike) {
    const b = world.bounds;
    const sx = MM_W / (b.maxX - b.minX);
    const sz = MM_H / (b.maxZ - b.minZ);
    const X = (x) => (x - b.minX) * sx;
    const Z = (z) => (z - b.minZ) * sz;
    mm.clearRect(0, 0, MM_W, MM_H);
    mm.drawImage(staticLayer, 0, 0);
    // Spike marker.
    if (spike && (spike.state === 'dropped' || spike.state === 'planted')) {
      mm.save();
      mm.translate(X(spike.position.x), Z(spike.position.z));
      mm.rotate(Math.PI / 4);
      mm.fillStyle = spike.state === 'planted' ? '#e5484d' : '#f0a830';
      mm.fillRect(-5, -5, 10, 10);
      mm.restore();
    }
    // Enemy pings (recent gunfire only).
    for (const ping of pings) {
      mm.fillStyle = 'rgba(229,72,77,0.9)';
      mm.beginPath();
      mm.arc(X(ping.x), Z(ping.z), 4, 0, Math.PI * 2);
      mm.fill();
    }
    // Teammates.
    for (const mate of teammates) {
      if (!mate.alive) continue;
      mm.fillStyle = '#f0a830';
      mm.beginPath();
      mm.arc(X(mate.position.x), Z(mate.position.z), 4, 0, Math.PI * 2);
      mm.fill();
    }
    // Player arrow.
    mm.save();
    mm.translate(X(player.x), Z(player.z));
    mm.rotate(Math.atan2(player.forwardX, -player.forwardZ));
    mm.fillStyle = '#f2ead9';
    mm.beginPath();
    mm.moveTo(0, -7);
    mm.lineTo(5, 5);
    mm.lineTo(-5, 5);
    mm.closePath();
    mm.fill();
    mm.restore();
  }

  // --- Buy menu.
  const BUY_ITEMS = [
    ...Object.values(WEAPONS).filter((w) => w.slot === 1),
    { id: 'armor', name: ARMOR_NAME, kind: 'Protection', price: ARMOR_PRICE, desc: 'Halves damage taken until it breaks. Kept while you survive.' },
  ];
  const buyButtons = new Map();
  for (const item of BUY_ITEMS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.innerHTML = `<span class="nm"></span><span class="kd"></span><span class="pr"></span><span class="ds"></span><span class="own"></span>`;
    button.querySelector('.nm').textContent = item.name;
    button.querySelector('.kd').textContent = item.kind;
    button.querySelector('.pr').textContent = formatMoney(item.price);
    button.querySelector('.ds').textContent = item.desc;
    button.addEventListener('click', () => buyHandler && buyHandler(item.id));
    els.buyGrid.appendChild(button);
    buyButtons.set(item.id, button);
  }

  return {
    setHealth(hp, armor) {
      const h = Math.max(0, Math.round(hp));
      if (h !== lastHealth) {
        lastHealth = h;
        els.healthNum.textContent = String(h);
        els.healthBar.style.width = `${h}%`;
        els.healthNum.classList.toggle('low', h <= 30);
        els.vignette.classList.toggle('lowhp', h > 0 && h <= 30);
      }
      const a = Math.max(0, Math.round(armor));
      if (a !== lastArmor) {
        lastArmor = a;
        els.armorBar.style.width = `${a}%`;
        els.armorNum.textContent = a > 0 ? String(a) : '';
      }
    },
    setAmmo(mag, reserve, weaponName, reloading) {
      const key = `${mag}|${reserve}|${weaponName}|${reloading}`;
      if (key === lastAmmo) return;
      lastAmmo = key;
      els.ammoMag.textContent = String(mag);
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.weaponName.textContent = weaponName;
      els.ammoWrap.classList.toggle('empty', mag === 0);
      els.ammoWrap.classList.toggle('reloading', !!reloading);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      els.money.textContent = formatMoney(value);
      els.buyMoney.textContent = formatMoney(value);
    },
    setTimer(seconds, mode) {
      els.timer.textContent = formatTime(seconds);
      els.timer.classList.toggle('urgent', mode === 'urgent');
      els.timer.classList.toggle('spike', mode === 'spike');
    },
    setScore(van, sen, round, target) {
      els.scoreVan.textContent = String(van);
      els.scoreSen.textContent = String(sen);
      els.roundLabel.textContent = `ROUND ${round} · FIRST TO ${target}`;
    },
    setAlive(attack, defend) {
      els.alive.innerHTML = `<b>${attack}</b> v <b>${defend}</b>`;
    },
    setSpike(state, site) {
      if (state === 'planted') {
        els.spikeStatus.hidden = false;
        els.spikeStatus.textContent = `SPIKE PLANTED · SITE ${site}`;
      } else if (state === 'carried') {
        els.spikeStatus.hidden = false;
        els.spikeStatus.textContent = 'YOU CARRY THE SPIKE — PLANT AT A OR B';
      } else {
        els.spikeStatus.hidden = true;
      }
    },
    killfeed(killerName, killerTeam, victimName, victimTeam, weaponShort, headshot, holdMs = 5200) {
      const row = document.createElement('div');
      const killer = document.createElement('span');
      killer.className = killerTeam === 'attack' ? 'van' : 'sen';
      killer.textContent = killerName;
      const wpn = document.createElement('span');
      wpn.className = 'wpn';
      wpn.textContent = `  ${headshot ? '☠ ' : ''}${weaponShort}  `;
      const victim = document.createElement('span');
      victim.className = victimTeam === 'attack' ? 'van' : 'sen';
      victim.textContent = victimName;
      row.append(killer, wpn, victim);
      els.killfeed.prepend(row);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => row.remove(), holdMs);
    },
    banner(text, sub, tone, holdMs = 2600) {
      els.bannerText.textContent = text;
      els.bannerText.className = tone;
      els.bannerSub.textContent = sub ?? '';
      els.banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        els.banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      els.banner.hidden = true;
    },
    eventLine(text, holdMs = 3200) {
      els.eventLine.textContent = text;
      els.eventLine.classList.add('on');
      clearTimeout(eventTimer);
      eventTimer = setTimeout(() => els.eventLine.classList.remove('on'), holdMs);
    },
    hitMarker(killed, holdMs = 90) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', !!killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFrom(worldAngle, cameraYaw) {
      const relative = worldAngle - cameraYaw;
      els.damageDir.style.transform = `translate(-50%,-50%) rotate(${relative}rad)`;
      els.damageDir.classList.add('on');
      els.vignette.classList.add('hurt');
      clearTimeout(damageTimer);
      clearTimeout(hurtTimer);
      damageTimer = setTimeout(() => els.damageDir.classList.remove('on'), 700);
      hurtTimer = setTimeout(() => els.vignette.classList.remove('hurt'), 160);
    },
    setCrosshairGap(px) {
      els.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    showScope(on) {
      els.scope.classList.toggle('on', on);
      els.crosshair.classList.toggle('scoped', on);
    },
    plantProgress(show, frac, label) {
      els.plantWrap.hidden = !show;
      if (show) {
        els.plantBar.style.width = `${Math.round(frac * 100)}%`;
        els.plantLabel.textContent = label;
      }
    },
    showBuy(open, money, owned) {
      els.buymenu.hidden = !open;
      if (!open) return;
      els.buyMoney.textContent = formatMoney(money);
      for (const item of BUY_ITEMS) {
        const button = buyButtons.get(item.id);
        const isOwned = owned.includes(item.id);
        const afford = money >= item.price;
        button.disabled = isOwned || !afford;
        button.querySelector('.own').textContent = isOwned ? 'OWNED' : '';
      }
    },
    refreshBuy(money, owned) {
      els.buyMoney.textContent = formatMoney(money);
      for (const item of BUY_ITEMS) {
        const button = buyButtons.get(item.id);
        const isOwned = owned.includes(item.id);
        button.disabled = isOwned || money < item.price;
        button.querySelector('.own').textContent = isOwned ? 'OWNED' : '';
      }
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    onBuyClose(handler) {
      els.buyClose.addEventListener('click', handler);
    },
    showScoreboard(open, rows) {
      els.scoreboard.hidden = !open;
      if (!open) return;
      els.scoreRows.innerHTML = '';
      for (const row of rows) {
        const tr = document.createElement('tr');
        if (row.me) tr.className = 'me';
        tr.innerHTML = `<td></td><td class="${row.team === 'attack' ? 'tv' : 'ts'}">${row.team === 'attack' ? 'VAN' : 'SEN'}</td><td class="num">${row.kills}</td><td class="num">${row.deaths}</td><td class="num">${formatMoney(row.money)}</td>`;
        tr.firstChild.textContent = row.name;
        els.scoreRows.appendChild(tr);
      }
    },
    showOverlay(mode, endCopy) {
      const text = COPY[mode];
      els.overlayTitle.innerHTML = text.title;
      els.overlayCopy.innerHTML = mode === 'end' ? endCopy : text.copy;
      els.play.textContent = text.action;
      els.overlay.hidden = false;
      els.play.focus();
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    onPlay(handler) {
      els.play.addEventListener('click', handler);
    },
    setHudVisible(visible) {
      els.hud.hidden = !visible;
    },
    drawMinimap,
  };
}
