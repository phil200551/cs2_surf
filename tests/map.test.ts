/**
 * Validates the beginner map headlessly with the real physics: a full run,
 * zero-velocity stage respawns, and every gap at a wide band of speeds and
 * riding lines (the ballistic check, done with the actual collision code).
 */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { BEGINNER_MAP, LAYOUT } from '../src/map/beginner';
import { compileMap } from '../src/map/compile';
import { makeMovementConfig } from '../src/physics';
import { rampCoords, SurfBot } from './bot';

const map = compileMap(BEGINNER_MAP);
const MAX_TICKS = 64 * 120;

interface RunResult {
  finished: boolean;
  time: number;
  fails: number;
  checkpoints: number[];
  groundedMidRun: number;
  maxSpeed: number;
}

/** Runs the bot from `stage`'s spawn until it finishes, fails, or `onTick` returns true. */
function botRun(stage: number, lateral = 120, onTick?: (game: Game, bot: SurfBot) => boolean | void): RunResult {
  const game = new Game(map, makeMovementConfig());
  const bot = new SurfBot(BEGINNER_MAP);
  bot.targetLateral = lateral;
  const r: RunResult = { finished: false, time: 0, fails: 0, checkpoints: [], groundedMidRun: 0, maxSpeed: 0 };
  game.hooks = {
    checkpoint: (s) => r.checkpoints.push(s),
    finished: (t) => {
      r.finished = true;
      r.time = t;
    },
    failed: () => r.fails++,
  };
  if (stage > 1) {
    // As in play: the run is under way, then the player is sent to a stage start.
    for (let t = 0; t < 64 * 10 && game.phase !== 'running'; t++) {
      bot.drive(game);
      game.step();
    }
    expect(game.phase).toBe('running');
    game.respawn(stage);
    bot.resync(game);
  }
  let leftSpawn = false;
  for (let t = 0; t < MAX_TICKS && !r.finished && r.fails === 0; t++) {
    bot.drive(game);
    if (onTick?.(game, bot)) break;
    game.step();
    if (!game.player.onGround) leftSpawn = true;
    else if (leftSpawn && !r.finished) r.groundedMidRun++;
    r.maxSpeed = Math.max(r.maxSpeed, game.player.vel.horizontalLength());
  }
  return r;
}

describe('beginner map', () => {
  it('compiles with the required triggers and stages', () => {
    const kinds = map.triggers.map((t) => t.def.kind);
    expect(kinds.filter((k) => k === 'start')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'end')).toHaveLength(1);
    expect(map.triggers.filter((t) => t.def.kind === 'checkpoint').map((t) => t.def.stage).sort()).toEqual([2, 3]);
    expect(kinds.filter((k) => k === 'fail').length).toBeGreaterThan(3);
    expect(BEGINNER_MAP.stages.map((s) => s.index)).toEqual([1, 2, 3]);
    for (const b of map.brushes) expect(b.brush.numFaces).toBeGreaterThanOrEqual(5);
  });

  it('ramps are about 512 x 448 with ~60 degree faces and 3000-6400 long', () => {
    expect(LAYOUT.rampHalfWidth * 2).toBe(512);
    expect(LAYOUT.rampHeight).toBe(448);
    const faceAngle = (Math.atan2(LAYOUT.rampHeight, LAYOUT.rampHalfWidth) * 180) / Math.PI;
    expect(faceAngle).toBeGreaterThan(59);
    expect(faceAngle).toBeLessThan(61);
    // Every ramp face is surfable (not ground) and every platform top is ground.
    for (const b of map.brushes) {
      for (const f of b.brush.faces) {
        if (b.primitive.kind === 'ramp' && f.normal.y > 0) expect(f.normal.y).toBeLessThan(0.7);
      }
    }
  });

  it('a beginner bot finishes the whole run from the start zone without failing', () => {
    const r = botRun(1);
    expect(r.fails).toBe(0);
    expect(r.checkpoints).toEqual([2, 3]);
    expect(r.finished).toBe(true);
    expect(r.time).toBeGreaterThan(20);
    expect(r.time).toBeLessThan(60);
    // Never lands anywhere mid-run: the respawn pads stay clear of the line.
    expect(r.groundedMidRun).toBe(0);
  });

  it.each([2, 3])('stage %i is completable from its pad starting at zero velocity', (stage) => {
    const r = botRun(stage);
    expect(r.fails).toBe(0);
    expect(r.finished).toBe(true);
  });

  /** Gap after route ramp `index` (or into the end platform after the last ramp). */
  const bot = new SurfBot(BEGINNER_MAP);
  const gaps: number[] = [];
  for (let i = 0; i < bot.route.length - 1; i++) {
    const a = bot.route[i].ramp;
    const b = bot.route[i + 1].ramp;
    if (Math.hypot(b.start.x - a.end.x, b.start.z - a.end.z) > 1) gaps.push(i);
  }
  gaps.push(bot.route.length - 1);

  const cases = gaps.flatMap((g) => [50, 120, 200].map((lateral) => ({ g, lateral, name: `${bot.route[g].ramp.name} -> ${bot.route[g + 1]?.ramp.name ?? 'end platform'} (line ${lateral})` })));

  it.each(cases)('gap $name lands from 0.6x to 2x the bot speed', ({ g, lateral }) => {
    const last = g === bot.route.length - 1;
    for (const factor of [0.6, 0.75, 1, 1.35, 1.7, 2]) {
      let applied = false;
      let landedNext = false;
      const r = botRun(1, lateral, (game, b) => {
        const info = b.route[g];
        const passed = rampCoords(info, game.player.pos.x, game.player.pos.z).along > info.length;
        if (!applied && passed && b.index >= Math.min(g + 1, b.route.length - 1)) {
          game.player.vel.x *= factor;
          game.player.vel.z *= factor;
          applied = true;
        }
        if (applied && !last && b.index >= g + 2) landedNext = true;
        return landedNext;
      });
      expect(applied, `factor ${factor} never reached the gap`).toBe(true);
      expect(r.fails, `factor ${factor}`).toBe(0);
      if (last) expect(r.finished, `factor ${factor}`).toBe(true);
      else expect(landedNext || r.finished, `factor ${factor}`).toBe(true);
    }
  });
});
