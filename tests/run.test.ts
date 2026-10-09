/** Run timer semantics on a tiny synthetic map. */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { compileMap } from '../src/map/compile';
import type { MapDef } from '../src/map/types';
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
