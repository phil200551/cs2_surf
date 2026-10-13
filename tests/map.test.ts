/**
 * Validates the beginner map headlessly with the real physics: a full run,
 * the speed build-up, zero-velocity stage respawns, every gap at a wide band
 * of speeds and riding lines (the ballistic check, done with the actual
 * collision code), and the curve's speed range.
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
  /** Horizontal speed when each checkpoint (stage 2, 3) was reached. */
  checkpointSpeeds: number[];
  finishSpeed: number;
  groundedMidRun: number;
  maxSpeed: number;
  boosts: number;
  /** Seconds from the run start to the first boost. */
  firstBoost: number;
}

/** Runs the bot from `stage`'s spawn until it finishes, fails, or `onTick` returns true. */
function botRun(stage: number, lateral = 120, onTick?: (game: Game, bot: SurfBot) => boolean | void): RunResult {
  const game = new Game(map, makeMovementConfig());
  const bot = new SurfBot(BEGINNER_MAP);
  bot.targetLateral = lateral;
  const r: RunResult = { finished: false, time: 0, fails: 0, checkpoints: [], checkpointSpeeds: [], finishSpeed: 0, groundedMidRun: 0, maxSpeed: 0, boosts: 0, firstBoost: NaN };
  const speed = () => game.player.vel.horizontalLength();
  game.hooks = {
    checkpoint: (s) => {
      r.checkpoints.push(s);
      r.checkpointSpeeds.push(speed());
    },
    finished: (t) => {
      r.finished = true;
      r.time = t;
      r.finishSpeed = speed();
    },
    failed: () => r.fails++,
    boosted: () => {
      if (r.boosts++ === 0) r.firstBoost = game.runTime();
    },
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
    r.maxSpeed = Math.max(r.maxSpeed, speed());
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
    // A launcher at every spawn plus boost gates along the course.
    expect(kinds.filter((k) => k === 'boost').length).toBeGreaterThanOrEqual(12);
    for (const t of map.triggers) if (t.def.kind === 'boost') expect(t.def.boost).toBeDefined();
    expect(BEGINNER_MAP.stages.map((s) => s.index)).toEqual([1, 2, 3]);
    for (const b of map.brushes) expect(b.brush.numFaces).toBeGreaterThanOrEqual(5);
  });

  it('ramps are about 512 x 448 with ~60 degree faces, and every ramp face is surfable', () => {
    expect(LAYOUT.rampHalfWidth * 2).toBe(512);
    expect(LAYOUT.rampHeight).toBe(448);
    const faceAngle = (Math.atan2(LAYOUT.rampHeight, LAYOUT.rampHalfWidth) * 180) / Math.PI;
    expect(faceAngle).toBeGreaterThan(59);
    expect(faceAngle).toBeLessThan(61);
    // Every ramp face is surfable (not ground), even on the steepest descents.
    for (const b of map.brushes) {
      for (const f of b.brush.faces) {
        if (b.primitive.kind === 'ramp' && f.normal.y > 0 && f.normal.y < 0.99) expect(f.normal.y).toBeLessThan(0.7);
      }
    }
  });

  it('a beginner bot finishes the whole run from the start zone without failing', () => {
    const r = botRun(1);
    expect(r.fails).toBe(0);
    expect(r.checkpoints).toEqual([2, 3]);
    expect(r.finished).toBe(true);
    expect(r.time).toBeGreaterThan(20);
    expect(r.time).toBeLessThan(40);
    // Never lands anywhere mid-run: the respawn pads stay clear of the line.
    expect(r.groundedMidRun).toBe(0);
  });

  it('launches at once and keeps building speed through every stage', () => {
    const r = botRun(1);
    // Launched off the start platform within two seconds of the timer starting.
    expect(r.firstBoost).toBeLessThan(2);
    const [atStage2, atStage3] = r.checkpointSpeeds;
    expect(atStage2).toBeGreaterThan(2800);
    expect(atStage3).toBeGreaterThan(atStage2 + 1000);
    expect(r.finishSpeed).toBeGreaterThan(atStage3 + 2000);
    expect(r.maxSpeed).toBeGreaterThan(7000);
    // Far past CS2's 3500 cap, and still under this game's 10,000 per axis.
    expect(r.maxSpeed).toBeLessThan(makeMovementConfig().maxVelocity * Math.SQRT2);
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

  it.each(cases)('gap $name lands from 0.5x to 2x the bot speed', ({ g, lateral }) => {
    const last = g === bot.route.length - 1;
    for (const factor of [0.5, 0.6, 0.75, 1, 1.25, 1.5, 2]) {
      let applied = false;
      let landedNext = false;
      const r = botRun(1, lateral, (game, b) => {
        const info = b.route[g];
        const passed = rampCoords(info, game.player.pos.x, game.player.pos.z).along > info.length;
        if (!applied && passed && b.index >= Math.min(g + 1, b.route.length - 1)) {
          // A slower or faster rider on the same line: scale the whole velocity.
          game.player.vel.scale(factor);
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

  // The level curve's inner face holds a rider only while v^2 / R <= g tan 60.
  const curveSegments = bot.route.flatMap((r, i) => (r.ramp.name?.startsWith('S2 curve') ? [i] : []));
  const curveStart = curveSegments[0];
  const curveEnd = curveSegments[curveSegments.length - 1];

  it.each([50, 120, 200])('the curve holds riders from 0.6x to 1.6x the bot speed (line %i)', (lateral) => {
    for (const factor of [0.6, 1, 1.3, 1.6]) {
      let applied = false;
      let passed = false;
      const r = botRun(1, lateral, (game, b) => {
        if (!applied && b.index === curveStart) {
          game.player.vel.scale(factor);
          applied = true;
        }
        passed = b.index > curveEnd;
        return passed;
      });
      expect(applied, `factor ${factor}`).toBe(true);
      expect(r.fails, `factor ${factor}`).toBe(0);
      expect(passed, `factor ${factor}`).toBe(true);
    }
  });
});
