# threejs-fps-02-entry

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Sisca876/threejs-fps-02-entry/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Sisca876/threejs-fps-02-entry/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

EMBERLINE — a complete round-based tactical FPS in three.js, built for make.fun's "Make the best three.js tactical FPS" bounty. Counter-Strike-style, fully original: your own desert relay-station map, art, sounds and names.

You play Fazz of the Vanguard (4v4 with AI bots). Plant the spike at site A or B, or eliminate the Sentinels. Rounds pay money; money buys guns. First team to 5 rounds takes the match.

What's in the game:

- **Three-lane map** — Relay Station Kestrel: mid arch, east ridge, west culvert, two bomb sites with a relay tower and fuel tanks, crates, sandbags and watch towers. All geometry and textures are generated in code; nothing is fetched over the network.
- **Bot AI** — waypoint navigation, line-of-sight perception with reaction delays, burst fire with aim error, strafing, rotation on sound, objective play: carriers plant the spike, defenders retake and defuse.
- **Full tactical loop** — buy phase with five guns plus kevlar, economy with kill rewards and loss bonuses, round timer, spike fuse, elimination/time/detonation/defuse win conditions, match score.
- **Gunfeel** — spread that punishes movement, recoil, scoped sniper, tracers, muzzle flashes, impact dust, hitmarkers, damage direction indicator, camera shake, view bob.
- **HUD** — health/armor, ammo, money, timer, scores, kill feed, live minimap, buy menu, scoreboard, plant/defuse progress.
- **Synthesized audio** — every sound is generated with WebAudio: gunshots, reloads, footsteps, spike beeps, explosions, round stingers, desert wind. No audio files.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. No build step: `game/` is plain static files loaded as ES modules, with three.js 0.187.0 vendored.

Deterministic captures for the screenshots live behind `?shot=start|play|buy|end&seed=N` (see `shots.json`).

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the kit's vendored library.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
