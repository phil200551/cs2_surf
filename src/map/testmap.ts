import type { MapDef } from './types';

/**
 * Gray-box test map: a spawn platform over a long ramp, a gap, a second ramp,
 * and a floor to land on. Load it with `?map=test`.
 */
export const TEST_MAP: MapDef = {
  id: 'graybox',
  name: 'Gray-box test',
  sun: { azimuth: 35, elevation: 50 },
  primitives: [
    { kind: 'box', material: 'platform', trim: true, name: 'spawn', min: { x: -256, y: 1192, z: 200 }, max: { x: 256, y: 1256, z: 712 } },
    { kind: 'ramp', material: 'stage1', trim: true, name: 'ramp 1', start: { x: 0, y: 1000, z: 600 }, end: { x: 0, y: 1000, z: -5000 }, ride: 'right' },
    { kind: 'ramp', material: 'stage2', trim: true, name: 'ramp 2', start: { x: 0, y: 500, z: -5400 }, end: { x: 0, y: 500, z: -9400 }, ride: 'right' },
    { kind: 'box', material: 'platform', trim: true, name: 'floor', min: { x: -1024, y: -264, z: -12000 }, max: { x: 1024, y: -200, z: -9800 } },
  ],
  triggers: [{ kind: 'fail', stage: 1, min: { x: -20000, y: -3000, z: -20000 }, max: { x: 20000, y: -1500, z: 20000 } }],
  stages: [{ index: 1, name: 'Test', spawn: { x: 0, y: 1257, z: 500 }, yaw: 0 }],
};
