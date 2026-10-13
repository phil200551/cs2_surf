/** Run timer and booster semantics on tiny synthetic maps. */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { boostZone } from '../src/map/builders';
import { compileMap } from '../src/map/compile';
import type { BoostDef, MapDef } from '../src/map/types';
import { makeMovementConfig } from '../src/physics';

const corridor: MapDef = {
  id: 'corridor',
  name: 'Corridor',
  sun: { azimuth: 0, elevation: 45 },
  primitives: [{ kind: 'box', material: 'platform', min: { x: -512, y: -64, z: -20000 }, max: { x: 512, y: 0, z: 1000 } }],
  triggers: [
    { kind: 'start', stage: 1, min: { x: -512, y: 0, z: 0 }, max: { x: 512, y: 200, z: 1000 } },
    { kind: 'checkpoint', stage: 2, min: { x: -512, y: 0, z: -5100 }, max: { x: 512, y: 200, z: -5000 } },
    { kind: 'end', stage: 2, min: { x: -512, y: 0, z: -10100 }, max: { x: 512, y: 200, z: -10000 } },
    { kind: 'fail', stage: 0, min: { x: -9999, y: -3000, z: -99999 }, max: { x: 9999, y: -1000, z: 99999 } },
  ],
  stages: [
    { index: 1, name: 'one', spawn: { x: 0, y: 0.03125, z: 500 }, yaw: 0 },
    { index: 2, name: 'two', spawn: { x: 0, y: 0.03125, z: -5200 }, yaw: 0 },
  ],
};

describe('run timer', () => {
  it('starts on leaving the start zone and stops in the end zone with sub-tick precision', () => {
    // Zero-friction glide at exactly 1000 u/s so crossings are analytic.
    const game = new Game(compileMap(corridor), makeMovementConfig({ friction: 0 }));
    const events: string[] = [];
    game.hooks = { runStarted: () => events.push('start'), checkpoint: (s) => events.push(`cp${s}`), finished: () => events.push('end') };
    game.player.vel.set(0, 0, -1000);
    while (game.phase !== 'finished' && game.tickCount < 64 * 30) game.step();
    expect(events).toEqual(['start', 'cp2', 'end']);
    // The hull leaves the start zone when its back face passes z = 0 (origin
    // at -16) and touches the end zone when its front reaches z = -10000
    // (origin at -9984): 9968 units at 1000 u/s.
    expect(game.finishTime).toBeCloseTo(9.968, 6);
    // Checkpoint gate front face at z = -5000: origin at -4984, 4968 units in.
    expect(game.splits[1]).toBeCloseTo(4.968, 6);
  });

  it('re-entering the start zone resets the run; failing respawns at the last checkpoint', () => {
    const game = new Game(compileMap(corridor), makeMovementConfig({ friction: 0 }));
    game.player.vel.set(0, 0, -1000);
    for (let i = 0; i < 64 * 6; i++) game.step();
    expect(game.phase).toBe('running');
    expect(game.stage).toBe(2);
    game.player.pos.set(0, -2000, -6000); // fall into the fail volume
    game.step();
    expect(game.stage).toBe(2);
    expect(game.player.pos.z).toBeCloseTo(-5200, 6);
    expect(game.player.vel.length()).toBe(0);
    expect(game.phase).toBe('running');
    game.restartRun();
    expect(game.phase).toBe('ready');
    expect(game.runTime()).toBe(0);
  });
});

describe('boosters', () => {
  /** A small platform to spawn on, and one booster centred at z = -2000 pushing toward -Z. */
  const boostMap = (boost: BoostDef, halfZ: number, center = { x: 0, y: 0, z: -2000 }): MapDef => ({
    id: 'boost',
    name: 'Boost',
    sun: { azimuth: 0, elevation: 45 },
    primitives: [{ kind: 'box', material: 'platform', min: { x: -512, y: -64, z: -4000 }, max: { x: 512, y: 0, z: 1000 } }],
    triggers: [boostZone(1, center, 512, 3000, halfZ, boost)],
    stages: [{ index: 1, name: 'one', spawn: { x: 0, y: 0.03125, z: 600 }, yaw: 0 }],
  });

  it('a boost gate adds speed along its heading once, even when crossed within one tick', () => {
    const map = compileMap(boostMap({ heading: 0, add: 500, min: 0 }, 40));
    // At 9000 u/s a tick moves 140 units: more than the 80-unit gate plus the
    // 32-unit hull, so some of these starts never overlap it at a tick boundary.
    for (const offset of [0, 30, 60, 90, 120]) {
      const game = new Game(map, makeMovementConfig());
      let boosts = 0;
      game.hooks = { boosted: () => boosts++ };
      game.player.pos.set(0, 1000, -1000 - offset);
      game.player.onGround = false;
      game.player.vel.set(0, 0, -9000);
      for (let i = 0; i < 32; i++) game.step();
      expect(boosts, `offset ${offset}`).toBe(1);
      expect(game.player.vel.z).toBeCloseTo(-9500, 9);
      expect(game.player.vel.x).toBe(0);
    }
  });

  it('a boost never pushes an axis past sv_maxvelocity', () => {
    const map = compileMap(boostMap({ heading: 0, add: 800, min: 0 }, 40));
    const game = new Game(map, makeMovementConfig());
    let after = 0;
    game.hooks = { boosted: () => (after = game.player.vel.z) };
    game.player.pos.set(0, 1000, -1500);
    game.player.onGround = false;
    game.player.vel.set(0, 0, -9700);
    for (let i = 0; i < 16; i++) game.step();
    expect(after).toBe(-10000);
  });

  it('a launcher raises a slow rider to its minimum speed and leaves a fast one alone', () => {
    const map = compileMap(boostMap({ heading: 0, add: 0, min: 2000 }, 600, { x: 0, y: 1500, z: -2000 }));
    // Dropping in from above at walking pace with some sideways drift.
    const slow = new Game(map, makeMovementConfig());
    slow.player.pos.set(0, 4600, -1800);
    slow.player.onGround = false;
    slow.player.vel.set(120, 0, -250);
    for (let i = 0; i < 64; i++) slow.step();
    expect(slow.player.vel.z).toBeCloseTo(-2000, 9);
    expect(slow.player.vel.x).toBeCloseTo(120, 9);
    // Already faster than the minimum: untouched, and no boost reported.
    const fast = new Game(map, makeMovementConfig());
    let boosts = 0;
    fast.hooks = { boosted: () => boosts++ };
    fast.player.pos.set(0, 1500, -1000);
    fast.player.onGround = false;
    fast.player.vel.set(0, 0, -3000);
    for (let i = 0; i < 64; i++) fast.step();
    expect(boosts).toBe(0);
    expect(fast.player.vel.z).toBe(-3000);
  });

  it('a booster with an upward kick lifts a grounded player off the ground', () => {
    const map = compileMap(boostMap({ heading: 0, add: 1500, min: 0, up: 400 }, 64, { x: 0, y: 100, z: 0 }));
    const game = new Game(map, makeMovementConfig({ friction: 0 }));
    game.player.vel.set(0, 0, -800);
    let airborne = false;
    for (let i = 0; i < 64 && !airborne; i++) {
      game.step();
      airborne = !game.player.onGround && game.player.vel.y > 0;
    }
    expect(airborne).toBe(true);
    expect(game.player.vel.z).toBeCloseTo(-2300, 9);
    for (let i = 0; i < 16; i++) game.step();
    expect(game.player.pos.y).toBeGreaterThan(50);
  });
});
