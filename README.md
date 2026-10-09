# Skyline Surf

A first-person surf game for the browser whose movement is a port of the
Counter-Strike movement code (`CGameMovement::FullWalkMove`) with CS2 defaults
and the usual surf-server overrides. It ships with **Skyline**, an original
three-stage beginner map floating above a sea of clouds.

Movement and collision are written from scratch: there is no physics engine and
no character controller. Surfing is not a special state. A ramp steeper than the
ground limit is simply not ground, and gravity, velocity clipping and air
acceleration produce the surf on their own.

![Overview of stage 2](docs/overview.jpg)

| | |
|---|---|
| ![The curve](docs/curve.jpg) | ![Approaching the landing ramp and end zone](docs/landing.jpg) |
| ![Surfing stage 1](docs/surf.jpg) | ![Menu and settings](docs/menu.jpg) |

## Quick start

```sh
npm install
npm run dev        # open the printed URL, click Play
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Strict typecheck, then production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest: physics proofs, map validation, timer, allocation checks |

Add `?map=test` to the URL for the small gray-box test map.

The stack is Vite, TypeScript (strict), Three.js r186, pmndrs `postprocessing`
6, Vitest, and plain DOM/CSS for the HUD. It needs a WebGL2 browser; Chromium
gets the full feature set (raw mouse input, Keyboard Lock).

## Controls

| Key | Action |
|---|---|
| W A S D | Move on the ground, air strafe in the air |
| Mouse | Look (raw input, CS2 sensitivity scale) |
| Space, or mouse wheel down | Jump. Hold to bunny hop (auto-bhop) |
| Ctrl or C | Duck |
| R | Restart the run (back to the start zone) |
| E | Restart the current stage |
| Esc | Menu (pauses) |
| F3 | Debug overlay |

Clicking **Play** captures the mouse with Pointer Lock (`unadjustedMovement:
true` for raw counts, with a fallback where unsupported), goes fullscreen, and
takes a Keyboard Lock so Ctrl+W, Ctrl+S and Ctrl+D reach the game instead of
the browser. Every game key also has its default suppressed.

**How to surf:** walk off the start platform and land on the face of the ramp
below. Hold the strafe key that pushes you *into* the ramp (A on a right-hand
face, D on a left-hand face) and steer with the mouse. Holding into a 60° face
cancels the slide down it (and even climbs slowly). To gain speed, turn the view
slightly downhill while holding the key. Air strafing works as in CS: hold A or
D and turn the mouse the same way.

## How the movement works

All gameplay math is in Hammer units, +Y up. The player is an axis-aligned box,
32 × 32 × 72 (54 ducked), with its origin at the feet; the eye is 64 above the
feet (46 ducked). A surface is ground only if its normal's up component is
≥ 0.7. That one rule is what makes surfing exist.

Every tick (64 Hz, `src/physics/movement.ts`, `PlayerController.tick`):

1. `wishdir` = WASD projected on the horizontal plane using view yaw only,
   normalized. With any key down, `wishspeed` = 250 (× 0.34 ducked).
2. Apply half of `gravity × dt` to the vertical velocity.
3. If grounded and jump is held: vertical velocity = 301.993 and leave the
   ground. This runs before friction, so bunny hops keep their speed.
4. Grounded: friction, ground accelerate, then `WalkMove` (a step/slide move
   plus `StayOnGround`). Airborne: air accelerate, then slide move.
5. Re-check ground: trace the hull 2 units down. The player is grounded only if
   that hits a plane with up-normal ≥ 0.7 while vertical velocity ≤ 140.
6. Apply the other half of gravity; if grounded, zero the vertical velocity.
7. Clamp each velocity axis to ±3500.

- **Friction:** `drop = max(speed, stopspeed) × friction × dt`, then scale the
  velocity by `max(speed − drop, 0) / speed`.
- **Ground accelerate:** `add = wishspeed − v·wishdir`; if positive,
  `v += wishdir × min(accelerate × dt × wishspeed, add)`.
- **Air accelerate:** `add = min(wishspeed, 30) − v·wishdir`; if positive,
  `v += wishdir × min(airaccelerate × wishspeed × dt, add)`. The 30 cap applies
  only to `add`; the acceleration term uses the full 250. This asymmetry is the
  whole mechanic and is deliberately preserved.
- **Slide move (`TryPlayerMove`):** up to 4 bumps. Trace the hull along
  `v × timeLeft`, advance to the hit, and clip the velocity against the hit
  plane. With two planes, slide along their crease (cross product). If the
  result opposes the original direction, stop. This also covers Source's
  first-impact-in-air clip and the "all fractions zero → stop" rule.
- **`StepMove`** (step up to 18 units), **`StayOnGround`**, and ducking (in the
  air the feet tuck up so the eye stays put; on the ground the eye eases down)
  are ported as well.

### Collision

- The world is **convex brushes**. Every primitive (box, A-frame prism,
  convex-from-points) becomes a point cloud, from which `brushFromPoints`
  (`src/physics/brush.ts`) builds face planes and convex face polygons.
- **Bevel planes** are added the way Quake 3's BSP compiler does: the axial
  planes, plus planes through each non-axial edge crossed with each axis, kept
  when the brush lies behind them. With these, "offset every plane by the box
  support" is an *exact* Minkowski sum of the brush and the player box, so the
  hull never catches on phantom corners beyond a brush's real edges.
- **Swept-AABB trace** (`CollisionWorld.traceBox`, `src/physics/world.ts`) ports
  `CM_ClipBoxToBrush`: offset each plane by the hull's support, clip the segment,
  and report fraction, hit normal, `startSolid` and `allSolid`.
- **Broadphase:** a BVH over brush bounds, traversed with a preallocated stack.
- The hull is kept **0.03125 units** (`DIST_EPSILON`) off whatever it hits.
- Render meshes are generated from the **same brushes** (`src/render/meshes.ts`),
  so visuals and collision always match.

### Ramp bugs

Crossing a seam between adjacent ramp brushes never costs speed. Four things
make that true:

1. **Exact entry test.** Source inflates every plane by epsilon *before*
   deciding whether the sweep enters a brush. Offsetting planes is not a true
   offset of a polytope: at convex edges the inflated planes meet in sharp
   corners that bulge past the brush, and a hull riding a face at exactly
   epsilon sits inside the bulge of the next segment's end cap and gets
   stopped. This is the classic seam ramp bug. Here the entry is decided
   exactly (Cyrus–Beck against the exact Minkowski sum), and only then is the
   stop point backed off epsilon along the entry plane.
2. **The specified fix.** If a move is blocked at fraction 0 by a plane that the
   velocity is already parallel to or leaving (`v·n ≥ −1e-4·|v|`), nudge out
   0.03125 along the normal and retry instead of clipping.
3. **No duplicate planes.** A plane within 0.26° of one already clipped this
   move is never added to the list again (Quake 3 does the same), because two
   near-identical planes would produce a zero-length crease and stop the
   player.
4. **Lifted retrace** for misaligned brushes (Hammer-style 0.004-unit offsets
   leave real sub-epsilon ledges at seams). When blocked by a plane other than
   the one being ridden, the move is retraced from 0.2 units off the ridden
   surface and that path is used if it gets farther. Momentum-mod style ramp
   fixes do something similar.

A safety net, `unstick`, pushes the hull out of any brush it is found inside,
along that brush's shallowest plane.

### Proofs (Vitest, headless, `src/physics`)

| Test | Result |
|---|---|
| Air strafe: 250 u/s, gravity off, hold D while yawing right at 120°/s for 2 s | speed rises every tick and never drops; W alone gains exactly nothing |
| Slide: no input on an exact 60° ramp, from the ridge to the base | never grounded; Δspeed² is within 2% of 2·g·Δh (it actually matches to 0.0014%, because the half-step gravity is a leapfrog integrator) |
| Surf: mid-face at 800 u/s, strafe into the ramp, view parallel, 5 s | in contact every tick, never grounded, never sinks, along-ramp speed within 1% (exactly 800) |
| Seams: 1,000+ crossings at 500–3000 u/s on split ramps (random yaw, descent, lengths; half with misaligned brushes) | no tick loses ≥ 1% speed |
| Bhop: hold jump across flat ground at 600 u/s | horizontal speed never drops below 600 |

Extra suites go further. `seams.stress.test.ts` runs 6,000+ crossings over
several seeds plus curved ramps with 2–8° joints, where the worst
energy-equivalent loss is the geometric cost of the turn. `trace.test.ts`
covers brushes, traces, bevels, steps, ducking and jump height.
`alloc.test.ts` is described under Performance.

## The map: Skyline

The map is data (`src/map/beginner.ts`): a list of primitives, trigger volumes
and stage spawns, assembled with small builders (`src/map/builders.ts`). Every
dimension that shapes a gap lives in `LAYOUT`. Ramps are A-frames 512 wide and
448 tall (faces 60.3° from horizontal). The course is about 45,000 units of path
and drops about 8,000 units from the start platform to the end platform.

- **Stage 1, blue.** A spawn platform inside the start zone floats over the
  first ramp (6,400 long, gently descending: the extra-long, forgiving one).
  One easy 384-unit gap leads to a second ramp.
- **Stage 2, orange.** Four ramps that alternate right and left faces
  (left-face ramps sit 256 units to the side, so the same lane lands on the
  facing side), then a gentle 60° right-hand curve of twelve 5° segments with a
  straight lead-in, ridden on its inner face.
- **Stage 3, violet.** A big drop: eight segments whose descent steepens
  (4°→26°) and then flattens (→6°). It is gentler than a ballistic arc, so
  riders stay on it, and it turns height into speed. Then a 1,500-unit air gap
  to a long landing ramp, and the end platform with the end zone.

**Triggers.** A start zone, a fly-through checkpoint gate at the start of
stages 2 and 3, an end zone, and fail volumes: a sloped volume under every ramp
and the gap leading to it (so a fall is short wherever it happens), plus a
catch-all under everything. A fail teleports to the current stage's start with
zero velocity. Each stage start is a small pad floating above the incoming
flight band, so it never blocks the line.

**Validation.** `tests/map.test.ts` plays the map headlessly with the real
physics. A deliberately unskilled bot (`tests/bot.ts`) looks down each ramp and
holds the strafe key into its face, with no air-strafe gains.

- The bot finishes in **33.6 s** (checkpoints at 14.9 s and 27.9 s; top speed
  about 2,260 u/s) without failing and without ever landing mid-run.
- Stages 2 and 3 are completable starting from their pads at zero velocity.
- **Every gap** lands cleanly with the exit speed scaled from **0.6× to 2.0×**
  the bot's (bot exit speeds 875–2,200 u/s), on three riding lines (50, 120 and
  200 units from the ridge). A competent run sits around 1.2–1.5× the bot, so
  the map leaves margin on both sides.

## Rendering

- **Sky:** a procedural shader (`src/render/sky.ts`) with a zenith-to-horizon
  gradient, an HDR sun disc that blooms, a soft FBM cloud layer, and a sea of
  clouds far below the course. It is baked once into a cubemap and PMREM for
  **sky-derived environment lighting**.
- **Fog** is FogExp2, but Three's fog chunks are replaced so fog uses radial
  distance and takes its colour from the sky in the view direction: the horizon
  and distant ramps always match.
- **Surfaces:** `MeshPhysicalMaterial` (light clearcoat) in one bold colour per
  stage, with an antialiased **world-space grid** (128-unit minor lines,
  512-unit major lines) projected on each face's dominant plane so speed is
  readable.
- **Emissive trim** along ridges, ramp lips and platform edges. The trim bands
  are cut out of the faces (a coplanar partition, not an overlay), so they can
  never z-fight. They are HDR, so bloom picks them up.
- **Zones** are translucent, additive, glowing boxes (green start, cyan
  checkpoint, gold end) that fade near the camera, so standing inside one tints
  the view instead of whiting it out.
- **Lighting:** one sun with shadows (2048² map covering ±2,400 units) that
  follow the player, snapped to shadow texels and re-rendered only when the
  snapped centre moves (the world is static); hemisphere fill; IBL.
- **Post:** an HDR (half-float) buffer with 4× MSAA (SMAA where MSAA is
  unavailable), then bloom, then ACES filmic tone mapping.
- **Depth:** a logarithmic depth buffer for the 100,000-unit far plane.
- **Camera:** a fixed vertical FOV of 73.74°, i.e. CS2's 90° horizontal at 4:3,
  Hor+. There is no view bob, sway, roll, camera lag, FOV kick or motion blur.

## Audio

Everything is synthesized with Web Audio (`src/audio/audio.ts`), with no asset
files. Wind is looping pink noise through a band-pass filter whose gain and
centre frequency follow horizontal speed, plus a high "whistle" layer at speed.
There is a landing thud scaled by impact speed, a start blip, a two-note
checkpoint chime, and a finish arpeggio (brighter on a personal best), all
through a light echo and a compressor.

## HUD and settings

- **HUD:** a bottom-centre speedometer (integer horizontal u/s); a run timer
  (`mm:ss.mmm`) that starts when the hull leaves the start zone and stops when
  it touches the end zone, both at sub-tick precision from a swept-hull test;
  the stage indicator; the personal best; split messages with ± deltas against
  the PB's splits; a static crosshair; and an optional key-press overlay.
- **F3 overlay:** fps, frame time, tick time, position, velocity (horizontal and
  3D speed), grounded and ducked flags, last hit normal (and whether it was
  touched this tick), stage and run phase.
- **Settings** (persisted in `localStorage`): sensitivity, volume, render scale
  (50–125%), bloom, shadows, key overlay, and a PB reset. The PB and its splits
  are stored per map.

## Performance

- **Zero allocations in the tick and trace hot paths.** The tick and trace code
  never creates objects, arrays, closures or strings; scratch vectors are
  preallocated. V8 also allocates a boxed number when a double is written to a
  field it treats as "tagged", or passed across a call it chose not to inline,
  so:
  - every numeric class field has a numeric initializer (class-field semantics
    would otherwise first define it as `undefined`);
  - the hot movement code does its vector math inline instead of calling
    helpers that take or return doubles;
  - `src/physics/alloc.test.ts` surfs for 1,000,000 ticks across seams, and
    traces 1,000,000 boxes, and requires that **no garbage collection** runs.
- **JIT warm-up.** Before Play is enabled, about 20,000 scripted ticks
  (walking, jumping, ducking, surfing, respawning) run on the real `Game` with
  its hooks muted, so V8 has optimized every movement path before the run. This
  is the CPU counterpart of precompiling shaders. Afterwards only rare cold
  paths (respawn, the seam retrace) show any boxing, averaging about 3 bytes per
  tick.
- **Shaders are precompiled** (`compileAsync`, plus one warm-up frame through
  every pass, shadows included) while the menu says "Loading". Toggling
  shadows recompiles at once, while you're still in the menu.
- **Static geometry is merged per material:** 4 surface meshes and 4 trim
  meshes. A frame is about 30 draw calls including the shadow and post passes,
  and about 3k triangles. The sky is drawn after opaque geometry with a depth
  test, so its noise shader only runs on pixels that are actually sky.
- **Cost:** a simulation tick takes about 2 µs (2.1 µs measured in Chromium;
  1.9 µs in Node with the validation bot driving it). The HUD writes to the DOM
  only when a value changes. The F3 overlay refreshes at 10 Hz.

## Tunables

### Movement: `src/physics/config.ts` (`DEFAULT_MOVEMENT`)

| Name | Default | Meaning |
|---|---|---|
| `tickrate` | 64 | Simulation rate (Hz) |
| `gravity` | 800 | sv_gravity (u/s²) |
| `maxSpeed` | 250 | Wish speed |
| `accelerate` | 5.5 | sv_accelerate |
| `friction` | 5.2 | sv_friction |
| `stopSpeed` | 80 | sv_stopspeed |
| `airAccelerate` | 150 | sv_airaccelerate (surf) |
| `airSpeedCap` | 30 | Cap on the air `add` term only |
| `jumpVelocity` | 301.993 | Jump impulse, sqrt(2·800·57) |
| `maxVelocity` | 3500 | Per-axis clamp |
| `stepHeight` | 18 | Max step |
| `duckSpeedMultiplier` | 0.34 | Wish speed multiplier while ducked |
| `autoBhop` | true | Holding jump re-jumps on landing |
| `groundNormalMinY` | 0.7 | Minimum up-normal for ground |
| `nonJumpVelocity` | 140 | Rising faster than this is never grounded |
| `groundTraceDistance` | 2 | Ground check trace length |
| `distEpsilon` | 0.03125 | Hull clearance from surfaces |
| `hullHalfWidth` / `hullHeight` / `duckHullHeight` | 16 / 72 / 54 | Player box |
| `eyeHeight` / `duckEyeHeight` | 64 / 46 | Eye above the feet |
| `duckViewSpeed` | 144 | Eye easing speed when ducking on the ground (u/s) |
| `maxBumps` / `maxClipPlanes` | 4 / 5 | TryPlayerMove limits |

There is no stamina and no fall damage.

Ramp-fix constants live at the top of `src/physics/movement.ts`:

| Name | Default | Meaning |
|---|---|---|
| `PARALLEL_TOLERANCE` | 1e-4 | "Already parallel" threshold, relative to speed |
| `SAME_PLANE_DOT` | 0.99999 | Normals closer than this count as one plane |
| `NUDGE_DISTANCE` | 0.03125 | Push-off distance after a spurious block |
| `MAX_NUDGES` | 3 | Nudges allowed per move |
| `RETRACE_LIFT` | 0.2 | Lift off the ridden plane for the retrace |
| `MAX_RETRACES` | 2 | Retraces allowed per move |

### Client: `src/config.ts` (`CLIENT`)

| Name | Default | Meaning |
|---|---|---|
| `fovVertical` | 73.74° | CS2 90° horizontal at 4:3, Hor+ |
| `near` / `far` | 2 / 100,000 | Clip planes |
| `yawDegreesPerCount` / `pitchDegreesPerCount` | 0.022 | m_yaw / m_pitch |
| `maxPitch` | 89° | Pitch clamp |
| `maxFrameTime` | 0.25 s | Accumulator clamp |
| `defaults` | sens 1.25, volume 0.7, bloom on, shadows on, scale 100%, key overlay off | Initial settings |

### Look: `src/render/palette.ts` (`PALETTE`) and renderer constants

| Name | Default | Meaning |
|---|---|---|
| `surfaces.stage1/2/3/platform` | #2a86ff / #ff7426 / #a457ff / #dfe5ee | Stage colours |
| `trims.*`, `trimIntensity` | lighter tints, × 3.4 | Emissive trims (HDR) |
| `sky.zenith/horizon/haze/sun` | #125ad4 / #9ccbf6 / #b2cdea / #fff2dc | Sky and fog colours |
| `sunIntensity`, `hemisphereIntensity`, `envIntensity` | 2.9, 0.38, 0.5 | Lighting |
| `exposure` | 0.92 | ACES exposure |
| `fogDensity` | 1/34,000 | FogExp2 density |
| `cloudFloor` | −4,000 | Height of the sea of clouds |
| `TRIM_WIDTH` (`meshes.ts`) | 7 | Trim band width |
| `GRID_MINOR` / `GRID_MAJOR` (`materials.ts`) | 128 / 512 | Grid spacing |
| `SHADOW_EXTENT`, `SHADOW_MAP_SIZE`, `SHADOW_DISTANCE` (`renderer.ts`) | 2,400, 2,048, 9,000 | Shadow coverage |
| Bloom (`renderer.ts`) | threshold 1.05, smoothing 0.25, intensity 0.85, radius 0.72 | Bloom on HDR emissives |

### Map: `src/map/beginner.ts` (`LAYOUT`)

Ramp height and half-width (448 / 256), the alternation offset (256), and for
each stage the ramp lengths and descents, gap lengths and drops, the curve
(radius 3,600, −60° turn, 12 segments, 1,600 lead-in), the big-drop segment
slopes, the long gap (1,500 × 1,800 drop), the landing and end platform sizes,
and the pad clearance. Change anything there and `npm test` re-validates every
gap with the bot.

## Decisions made

- **Jump order is literal.** The spec says apply half of gravity, *then* set
  the vertical velocity to 301.993, which gives a jump apex of 59.4 units, not
  the continuous-time 57. It is kept as specified. Bunny hops are exactly
  lossless either way.
- **The trace's epsilon handling** decides entry exactly and then backs off
  epsilon, instead of Source's per-plane inflation. Rationale is under "Ramp
  bugs": inflation is the root cause of seam bugs. The hull still stops
  0.03125 off whatever it hits.
- **Exact Minkowski bevels**, as in Quake 3, so boxes do not catch on phantom
  extensions. A consequence, shared with Source, is that the flat top of a ridge
  is ground. On diagonal ramps the box's corner reaches 22.6 units from its
  centre, so riding right against a diagonal ridge can land you on it.
- **Ported:** `StepMove`, `StayOnGround`, ducking, and the first-impact air
  clip. **Not ported:** water, ladders, base velocity, Source's quadrant sub-box
  ground test, and its 0.25 surface-friction quirk on steep slopes, which the
  spec's air-accelerate formula does not include and which almost never binds
  at airaccelerate 150.
- **Wish speed** is 250 with any movement key, and opposing keys cancel. Ducked,
  it is 250 × 0.34 = 85 on the ground and in the air, CS2-style speed scaling
  rather than Source's scaling of a 450 input.
- **Ducking:** the hull changes instantly. In the air the feet tuck up 18 so the
  eye does not move. On the ground the eye eases 18 units over 0.125 s, Source's
  duck view transition. That is the only eased view value, and it is not
  movement smoothing.
- **Yaw convention:** 0 looks down −Z and positive turns left (Three.js
  `'YXZ'`). The mouse turns at counts × sensitivity × 0.022°, and each tick
  reads the latest yaw.
- **Linear map with fly-through checkpoint gates**, rather than a staged map
  with teleports. Stage pads float above the incoming flight band, so
  respawned players drop onto the stage's first ramp (zero velocity, as
  specified), while players arriving from the previous stage never touch them.
- **The curve is level and ridden on its inner face.** Rotated sections at equal
  heights keep every segment face an exact planar trapezoid (a descending arc
  would twist them), and the inner face "catches" the rider. A straight
  lead-in lets riders touch down before it turns. Stage 3 follows the curve's
  last chord, the direction riders actually leave in, not its end tangent.
- **The big drop is a profile, not a constant slope.** A constant 22° ramp
  falls away faster than a ballistic arc, and riders sailed over it. The
  steepen-then-flatten profile is ridden, and its near-level exit makes the
  long gap's landing predictable.
- **Fail volumes are sloped per ramp**, plus a catch-all, so a fall is about
  700 units wherever it happens. A fail teleports to the last checkpoint
  reached. In stage 1 that is the start zone, which resets the run, as on surf
  servers. Re-entering the start zone also resets the run.
- **Esc pauses** the simulation and the timer. A browser game has to survive
  focus loss, and a frozen world gives no advantage.
- **Mouse wheel down jumps**, like the common CS bind. When a timed run is in
  progress, a `beforeunload` prompt is the last line of defence against Ctrl+W
  in browsers without Keyboard Lock.
- **Logarithmic depth instead of reversed-Z.** It works through
  `postprocessing`'s render targets without float-depth plumbing, and the trim
  partition makes polygon offset unnecessary.
- **A sea of clouds below** gives depth and speed cues when looking down, and
  the fog takes the sky's colour per view direction, so far ramps dissolve
  into exactly what is behind them.
- **Spawn view pitch is −14°**, so the first thing you see is the ramp below the
  platform.

## Project layout

```
src/
  physics/      pure TS, no Three.js: vec3, brush (hull + bevels), world (BVH + trace),
                movement (FullWalkMove port), triggers, config, tests
  map/          map format, compiler (brush faces, visibility, trim edges), builders,
                Skyline, gray-box test map
  game/         Game (simulation + run timer + triggers), input, storage, JIT warm-up
  render/       renderer (composer, lights, shadows), sky + fog, materials, meshes, zones
  audio/        Web Audio synthesis
  hud/          HUD, menu/settings
tests/          map validation bot, gap/ballistics tests, run timer tests
```
