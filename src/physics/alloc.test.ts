/**
 * The tick and trace hot paths must not allocate. Allocating even 16 bytes
 * (one boxed double) per tick would fill V8's young generation within a
 * million ticks and force a scavenge, so after warm-up (JIT, inline caches) we
 * surf for a million ticks across seams and require that no GC ran.
 */
import { describe, expect, it } from 'vitest';
import { brushFromPoints, type Brush } from './brush';
import { aFramePoints } from './shapes';
import { faceToward, makeSim, yOnPlane } from './testutil';
import { Vec3 } from './vec3';
import { TraceResult } from './world';

function surfWorld() {
  // A long ramp split into seams so every path (nudge, retrace, clip) is hot.
  const brushes: Brush[] = [];
  for (let i = 0; i < 400; i++) {
    brushes.push(brushFromPoints(aFramePoints(new Vec3(0, 448, -i * 250), new Vec3(0, 448, -(i + 1) * 250), 448, 256)));
  }
  return makeSim(brushes);
}

/** Fewest GCs seen across `rounds` runs of `work` (a real allocation shows up in every round). */
async function minGcCount(work: () => void, rounds = 2): Promise<number> {
  let best = Infinity;
  for (let r = 0; r < rounds; r++) {
    const entries: unknown[] = [];
    const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
    observer.observe({ entryTypes: ['gc'] });
    work();
    await new Promise((res) => setTimeout(res, 30));
    observer.disconnect();
    best = Math.min(best, entries.length);
  }
  return best;
}

describe('zero allocation hot paths', () => {
  it('player ticks (surfing across seams) do not trigger garbage collection', async () => {
    const { pc, s, input, world } = surfWorld();
    const face = faceToward(world.brushes[0], { x: 1, y: 0.6, z: 0 });
    const y0 = yOnPlane(face.normal, face.dist, 120, -100, 0.03125, pc.standMins, pc.standMaxs);
    input.side = -1;
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        if (s.pos.z < -95000 || s.pos.y < 0) {
          pc.teleport(s, 120, y0, -100);
          s.vel.z = -1500;
        }
        input.yaw = Math.sin(i * 0.01) * 0.2;
        pc.tick(s, input);
      }
    };
    run(60000); // warm up the JIT
    expect(await minGcCount(() => run(1_000_000))).toBe(0);
  });

  it('box traces do not trigger garbage collection', async () => {
    const { world, pc } = surfWorld();
    const tr = new TraceResult();
    const a = new Vec3();
    const b = new Vec3();
    const run = (n: number) => {
      for (let i = 0; i < n; i++) {
        const z = -((i * 37) % 90000) - 0.5;
        a.x = 100.5;
        a.y = 600.5;
        a.z = z;
        b.x = 80.5;
        b.y = -100.5;
        b.z = z - 40;
        world.traceBox(a, b, pc.standMins, pc.standMaxs, tr);
      }
    };
    run(60000);
    expect(await minGcCount(() => run(1_000_000))).toBe(0);
  });
});
