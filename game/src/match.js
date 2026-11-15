// The match: rounds, phases, money and the spike. Five rounds wins the match.
// Each round: a 12-second buy phase, up to 100 seconds live, then the spike's
// 35-second fuse if planted. Kills pay $300; round wins pay $3,250; losses pay
// $1,900 plus a $500 streak bonus, capped at $3,400. Elimination ends the round —
// except after a plant, when the defenders must still defuse or the spike decides.
import * as THREE from 'three';

export const FREEZE_TIME = 12;
export const ROUND_TIME = 100;
export const SPIKE_TIME = 35;
export const END_TIME = 4;
export const WIN_TARGET = 5;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const MAX_LOSS_REWARD = 3400;
export const MAX_MONEY = 16000;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 4;

export function createMatch(hooks) {
  const match = {
    phase: 'idle',
    timeLeft: 0,
    round: 0,
    scores: { attack: 0, defend: 0 },
    site: 'A',
    money: new Map(),
    lossStreak: { attack: 0, defend: 0 },
    spike: { state: 'player', carrierId: null, position: new THREE.Vector3(), site: null },
    pendingMatchEnd: false,
    lastReason: '',
  };

  function setMoney(id, value) {
    match.money.set(id, Math.max(0, Math.min(MAX_MONEY, Math.round(value))));
  }

  function award(winner, reason) {
    const loser = winner === 'attack' ? 'defend' : 'attack';
    match.lossStreak[winner] = 0;
    match.lossStreak[loser] += 1;
    for (const [id, team] of hooks.combatantTeams()) {
      if (team === winner) setMoney(id, (match.money.get(id) ?? START_MONEY) + WIN_REWARD);
      else {
        const bonus = Math.min(MAX_LOSS_REWARD, LOSS_REWARD + LOSS_STREAK_BONUS * (match.lossStreak[loser] - 1));
        setMoney(id, (match.money.get(id) ?? START_MONEY) + bonus);
      }
    }
    match.lastReason = reason;
  }

  function endRound(winner, reason) {
    if (match.phase === 'end' || match.phase === 'over') return;
    match.scores[winner] += 1;
    award(winner, reason);
    match.phase = 'end';
    match.timeLeft = END_TIME;
    match.pendingMatchEnd = match.scores[winner] >= WIN_TARGET;
    hooks.onRoundEnd(winner, reason, { ...match.scores });
  }

  return {
    state: match,
    startMatch(combatantIds) {
      match.scores.attack = 0;
      match.scores.defend = 0;
      match.round = 0;
      match.lossStreak.attack = 0;
      match.lossStreak.defend = 0;
      match.pendingMatchEnd = false;
      for (const id of combatantIds) setMoney(id, START_MONEY);
      this.startRound();
    },
    startRound() {
      match.round += 1;
      // Alternate the favoured site slightly so rounds do not all pile onto A.
      match.site = hooks.random() < 0.55 ? 'A' : 'B';
      match.phase = 'freeze';
      match.timeLeft = FREEZE_TIME;
      match.spike.state = 'player';
      match.spike.carrierId = null;
      match.spike.site = null;
      hooks.onRoundStart(match.round, match.site);
    },
    update(dt, alive) {
      if (match.phase === 'idle' || match.phase === 'over') return;
      match.timeLeft -= dt;
      if (match.timeLeft > 0) return;
      if (match.phase === 'freeze') {
        match.phase = 'live';
        match.timeLeft = ROUND_TIME;
        hooks.onPhaseChange('live');
      } else if (match.phase === 'live') {
        endRound('defend', 'time');
      } else if (match.phase === 'planted') {
        hooks.onSpikeExploded(match.spike.site);
        endRound('attack', 'detonation');
      } else if (match.phase === 'end') {
        if (match.pendingMatchEnd) {
          match.phase = 'over';
          hooks.onMatchEnd(match.scores.attack >= WIN_TARGET ? 'attack' : 'defend', { ...match.scores });
        } else {
          this.startRound();
        }
      }
    },
    checkElimination(alive) {
      if (match.phase !== 'live' && match.phase !== 'planted') return;
      if (alive.defend === 0) {
        endRound('attack', 'elimination');
      } else if (alive.attack === 0 && match.phase === 'live') {
        endRound('defend', 'elimination');
      }
      // After a plant, a wiped attack leaves the defenders to defuse: the round
      // continues until the defuse or the detonation.
    },
    plant(site, position) {
      if (match.phase !== 'live') return false;
      match.spike.state = 'planted';
      match.spike.site = site;
      match.spike.position.copy(position);
      match.phase = 'planted';
      match.timeLeft = SPIKE_TIME;
      hooks.onSpikePlanted(site);
      return true;
    },
    defuse() {
      if (match.phase !== 'planted') return false;
      hooks.onSpikeDefused(match.spike.site);
      endRound('defend', 'defuse');
      return true;
    },
    dropSpike(position) {
      if (match.spike.state === 'planted') return;
      match.spike.state = 'dropped';
      match.spike.carrierId = null;
      match.spike.position.copy(position);
      match.spike.position.y = 0;
    },
    pickupSpike(carrierId) {
      if (match.spike.state !== 'dropped') return false;
      match.spike.state = carrierId === 'player' ? 'player' : 'bot';
      match.spike.carrierId = carrierId;
      return true;
    },
    giveSpikeToBot(botId) {
      match.spike.state = 'bot';
      match.spike.carrierId = botId;
    },
    killReward(id) {
      setMoney(id, (match.money.get(id) ?? START_MONEY) + KILL_REWARD);
    },
    getMoney(id) {
      return match.money.get(id) ?? START_MONEY;
    },
    spend(id, amount) {
      const current = match.money.get(id) ?? START_MONEY;
      if (current < amount) return false;
      setMoney(id, current - amount);
      return true;
    },
    // Bots shop with simple rules: rifle when rich, SMG or shotgun when broke,
    // one anchor sniper when flush.
    botLoadout(bot) {
      const money = match.money.get(bot.id) ?? START_MONEY;
      let weapon = 'pistol';
      if (bot.role === 'anchor' && bot.skill > 0.8 && money >= 4200 && match.round > 2) weapon = 'sniper';
      else if (money >= 2700) weapon = 'rifle';
      else if (money >= 1500 && bot.role === 'entry') weapon = 'shotgun';
      else if (money >= 1400) weapon = 'smg';
      const prices = { pistol: 0, smg: 1400, rifle: 2700, shotgun: 1500, sniper: 4200 };
      if (prices[weapon] > 0) this.spend(bot.id, prices[weapon]);
      return weapon;
    },
  };
}
