import type { Game } from './game';

/**
 * JIT warm-up, the CPU twin of shader precompilation: simulate a few seconds
 * of scripted play (walking off pads, jumping, ducking, strafing on ramps,
 * respawning) so V8 optimises every movement path before the real run.
 * It runs on the real Game (hooks muted) so the very objects used in play are
 * the ones the optimised code was specialised for, then resets it.
 */
export function warmUpSimulation(game: Game, ticks = 20000): void {
  const hooks = game.hooks;
  game.hooks = {};
  const input = game.input;
  const stages = game.map.def.stages.length;
  for (let t = 0; t < ticks; t++) {
    const phase = t % 640;
    if (phase === 0) game.respawn(1 + (Math.floor(t / 640) % stages));
    input.forward = phase < 220 ? 1 : 0;
    input.side = phase >= 160 ? ((t >> 5) & 1 ? -1 : 1) : 0;
    input.jump = phase % 97 < 12;
    input.duck = phase % 150 > 138;
    input.yaw = game.spawnYaw(game.stage) + Math.sin(t * 0.02) * 0.35;
    game.step();
  }
  input.clear();
  game.restartRun();
  game.tickCount = 0;
  game.hooks = hooks;
}
