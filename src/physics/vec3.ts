/**
 * Minimal mutable 3-vector used by the simulation. Every operation writes into
 * an explicit `out` argument so the tick and trace hot paths never allocate.
 *
 * Coordinates are Source/Hammer units with +Y up (Three.js convention).
 */
export class Vec3 {
  // Initialised as numbers (not left as declare-only fields, which class-field
  // semantics would first define as `undefined`): V8 then stores them as
  // in-place doubles, so writing a component never allocates.
  x = 0;
  y = 0;
  z = 0;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Readonly<Vec3Like>): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /** Length of the horizontal (XZ) component. */
  horizontalLength(): number {
    return Math.sqrt(this.x * this.x + this.z * this.z);
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  /** this += v * s */
  addScaled(v: Readonly<Vec3Like>, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  zero(): this {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    return this;
  }

  /** Normalizes in place and returns the previous length (Source's VectorNormalize). */
  normalize(): number {
    const len = this.length();
    if (len > 0) {
      const inv = 1 / len;
      this.x *= inv;
      this.y *= inv;
      this.z *= inv;
    }
    return len;
  }

  dot(v: Readonly<Vec3Like>): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export function dot(a: Readonly<Vec3Like>, b: Readonly<Vec3Like>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** out = a x b. `out` may alias neither input. */
export function cross(a: Readonly<Vec3Like>, b: Readonly<Vec3Like>, out: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** out = a + (b - a) * t */
export function lerp(a: Readonly<Vec3Like>, b: Readonly<Vec3Like>, t: number, out: Vec3): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}
