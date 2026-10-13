/**
 * Difficulty levels on the real map: the surf assist (Easy) carries careless
 * or idle players through the whole run, ramp respawns (Easy, Medium) put a
 * fallen player back on the ramp they fell from, and Hard keeps CS2 rules.
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { BEGINNER_MAP } from '../src/map/beginner';
import { compileMap } from '../src/map/compile';
import { makeMovementConfig } from '../src/physics';
import { SurfBot } from './bot';

const map = compileMap(BEGINNER_MAP);

/** How a careless player handles the keys and the view once off the start platform. */
interface Style {
  name: string;
  keys(t: number): { forward: number; side: number; yaw: number; jump?: boolean; duck?: boolean };
}

/** Deterministic pseudo-random number in [0, 1) that changes every 23 ticks. */
const noise = (t: number) => {
  const h = Math.sin(Math.floor(t / 23) * 12.9898) * 43758.5453;
  return h - Math.floor(h);
};

const STYLES: Style[] = [
  { name: 'presses nothing', keys: () => ({ forward: 0, side: 0, yaw: 0 }) },
  { name: 'holds A the whole way', keys: () => ({ forward: 0, side: -1, yaw: 0 }) },
  { name: 'holds D the whole way', keys: () => ({ forward: 0, side: 1, yaw: 0 }) },
  { name: 'looks backwards holding W', keys: () => ({ forward: 1, side: 0, yaw: Math.PI }) },
  { name: 'spins the view holding A', keys: (t) => ({ forward: 0, side: -1, yaw: t * 0.05 }) },
  {
    name: 'mashes random keys',
    keys: (t) => {
      const r = noise(t);
      return { forward: r > 0.8 ? 1 : r < 0.1 ? -1 : 0, side: r < 0.33 ? -1 : r < 0.66 ? 1 : 0, yaw: (r - 0.5) * 3, jump: r > 0.9, duck: r < 0.05 };
    },
  },
];

interface Result {
  finished: boolean;
  time: number;
  fails: number;
}

/** Walks off the start platform with W, then plays in the given style. */
function play(style: Style, assist: boolean): Result {
  const game = new Game(map, makeMovementConfig());
  game.assistEnabled = assist;
  game.rampRespawns = assist;
  const r: Result = { finished: false, time: 0, fails: 0 };
  game.hooks = {
    finished: (t) => {
      r.finished = true;
      r.time = t;
    },
    failed: () => r.fails++,
  };
  let launched = false;
  for (let t = 0; t < 64 * 90 && !r.finished && r.fails < 10; t++) {
    const input = game.input;
    input.clear();
    input.yaw = 0;
    if (!launched) {
      input.forward = 1;
      launched = !game.player.onGround;
    } else {
      const k = style.keys(t);
      input.forward = k.forward;
      input.side = k.side;
      input.yaw = k.yaw;
      input.jump = k.jump ?? false;
      input.duck = k.duck ?? false;
    }
    game.step();
  }
  return r;
}

describe('difficulty', () => {
  it.each(STYLES)('Easy: a player who $name finishes without a single fall', (style) => {
    const r = play(style, true);
    expect(r.fails).toBe(0);
    expect(r.finished).toBe(true);
    expect(r.time).toBeLessThan(35);
  });

  it('Hard: the same careless players do not get far without the assist', () => {
    for (const style of STYLES) {
      const r = play(style, false);
      expect(r.finished, style.name).toBe(false);
    }
  });

  it('Medium: a fall puts you back on the ramp you fell from, at the speed you had on it', () => {
    const game = new Game(map, makeMovementConfig());
    game.rampRespawns = true;
    const bot = new SurfBot(BEGINNER_MAP);
    let fails = 0;
    let view = { yaw: NaN, pitch: NaN };
    game.hooks = {
      failed: (yaw, pitch) => {
        fails++;
        view = { yaw, pitch };
      },
    };
    // Ride with the bot to the middle of stage 2's third ramp.
    const target = bot.route.findIndex((r) => r.ramp.name === 'S2 ramp 3');
    for (let t = 0; t < 64 * 60 && !(bot.index === target && game.assist.ramp >= 0); t++) {
      bot.drive(game);
      game.step();
    }
    for (let t = 0; t < 64; t++) {
      bot.drive(game);
      game.step();
    }
    const ramps = game.assist.ramps;
    const i = game.assist.lastRamp;
    expect(BEGINNER_MAP.primitives.filter((p) => p.kind === 'ramp')[i].name).toBe('S2 ramp 3');
    const entrySpeed = game.assist.lastSpeed;
    expect(entrySpeed).toBeGreaterThan(3000);
    const stage = game.stage;
    const runTime = game.runTime();

    // Fall: drop the player far below the ramp, into its fail volume.
    const p = game.player;
    p.pos.y -= 1600;
    game.step();
    expect(fails).toBe(1);
    expect(game.stage).toBe(stage);
    expect(game.phase).toBe('running');
    expect(game.runTime()).toBeGreaterThan(runTime);
    // Back near the start of the same ramp, on its face, moving along it at the entry speed.
    const along = (p.pos.x - ramps.startX[i]) * ramps.dirX[i] + (p.pos.z - ramps.startZ[i]) * ramps.dirZ[i];
    expect(along).toBeGreaterThan(200);
    expect(along).toBeLessThan(500);
    expect(p.vel.horizontalLength()).toBeCloseTo(entrySpeed, 0);
    expect(view.yaw).toBeCloseTo(ramps.heading[i], 9);
    // It lands on the ramp and carries on.
    for (let t = 0; t < 32; t++) {
      bot.drive(game);
      game.step();
    }
    expect(game.assist.ramp).toBe(i);
    expect(fails).toBe(1);

    // Falling from the same ramp again goes back to the start of the stage, at rest.
    p.pos.y -= 1600;
    game.step();
    expect(fails).toBe(2);
    const spawn = BEGINNER_MAP.stages.find((s) => s.index === stage)!.spawn;
    expect(p.pos.x).toBeCloseTo(spawn.x, 3);
    expect(p.pos.z).toBeCloseTo(spawn.z, 3);
    expect(p.vel.length()).toBe(0);
  });

  it('Hard: a fall goes back to the start of the stage at rest', () => {
    const game = new Game(map, makeMovementConfig());
    const bot = new SurfBot(BEGINNER_MAP);
    let fails = 0;
    game.hooks = { failed: () => fails++ };
    for (let t = 0; t < 64 * 12; t++) {
      bot.drive(game);
      game.step();
    }
    expect(game.stage).toBe(2);
    game.player.pos.y -= 1600;
    game.step();
    expect(fails).toBe(1);
    const spawn = BEGINNER_MAP.stages.find((s) => s.index === 2)!.spawn;
    expect(game.player.pos.z).toBeCloseTo(spawn.z, 3);
    expect(game.player.vel.length()).toBe(0);
  });
});
