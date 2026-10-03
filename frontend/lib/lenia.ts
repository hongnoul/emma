// Minimal single-channel Lenia engine for the prototype.
// Field A in [0,1] on an N x N toroidal grid. Update:
//   U = K (*) A   (normalized radial kernel)
//   G = 2*exp(-((U-mu)^2)/(2*sigma^2)) - 1
//   A = clip(A + dt*G, 0, 1)

export interface LeniaKernel {
  n: number; // grid size (kept for reference)
  r: number; // kernel radius in cells
  dx: Int16Array;
  dy: Int16Array;
  w: Float32Array; // normalized weights, sum = 1
}

function core(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return Math.exp(4 - 1 / (u * (1 - u)));
}

/** Radial kernel with one concentric bump per beta entry. */
export function makeKernel(R: number, beta: number[]): LeniaKernel {
  const dx: number[] = [];
  const dy: number[] = [];
  const w: number[] = [];
  const m = beta.length;
  for (let oy = -R; oy <= R; oy++) {
    for (let ox = -R; ox <= R; ox++) {
      const r = Math.sqrt(ox * ox + oy * oy) / R;
      if (r > 1) continue;
      const br = r * m;
      const i = Math.min(Math.floor(br), m - 1);
      const c = core(br - i);
      const wgt = beta[i] * c;
      if (wgt <= 1e-4) continue;
      dx.push(ox);
      dy.push(oy);
      w.push(wgt);
    }
  }
  let sum = 0;
  for (const v of w) sum += v;
  const wn = new Float32Array(w.length);
  for (let i = 0; i < w.length; i++) wn[i] = w[i] / (sum || 1);
  return { n: 0, r: R, dx: new Int16Array(dx), dy: new Int16Array(dy), w: wn };
}

/** Additive gaussian splat. label marks the dominant seed type per cell. */
export function seedBlob(
  a: Float32Array, lab: Uint8Array, n: number,
  cx: number, cy: number, rad: number, amp: number, label: number,
): void {
  const s2 = 2 * (rad / 2) * (rad / 2) + 1e-6;
  const x0 = Math.floor(cx - rad * 2);
  const x1 = Math.ceil(cx + rad * 2);
  const y0 = Math.floor(cy - rad * 2);
  const y1 = Math.ceil(cy + rad * 2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const xx = ((x % n) + n) % n;
      const yy = ((y % n) + n) % n;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      const v = amp * Math.exp(-d2 / s2);
      if (v < 0.02) continue;
      const idx = yy * n + xx;
      a[idx] = Math.min(1, a[idx] + v);
      if (v > 0.06) lab[idx] = label;
    }
  }
}

export function stepLenia(
  a: Float32Array, u: Float32Array, n: number,
  k: LeniaKernel, mu: number, sigma: number, dt: number,
): void {
  const { dx, dy, w } = k;
  const nk = w.length;
  const s2 = 2 * sigma * sigma;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let s = 0;
      for (let j = 0; j < nk; j++) {
        let nx = x + dx[j];
        let ny = y + dy[j];
        if (nx < 0) nx += n; else if (nx >= n) nx -= n;
        if (ny < 0) ny += n; else if (ny >= n) ny -= n;
        s += w[j] * a[ny * n + nx];
      }
      u[y * n + x] = s;
    }
  }
  for (let i = 0; i < n * n; i++) {
    const d = u[i] - mu;
    const g = 2 * Math.exp(-(d * d) / s2) - 1;
    let v = a[i] + dt * g;
    if (v < 0) v = 0; else if (v > 1) v = 1;
    a[i] = v;
  }
}

export function fieldMass(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

/** Deterministic string hash for stable seed layouts. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
