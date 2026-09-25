// Mesh -> voxels ("cubes").
//
// 1. Surface voxelization: every triangle is sampled densely; each grid cell it touches
//    becomes a surface cell and remembers the triangle + position on it.
// 2. Flood fill from the grid border through empty cells = "outside air".
// 3. Shell = surface cells next to outside air (the visible skin).
// Per shell cube we return the world position, the smooth mesh normal at that spot,
// the source triangle (for coloring / bone) and a crease-shading value.

// Smooth vertex normals (area weighted)
export function vertexNormals(pos, faces, N) {
  const n = new Float32Array(N * 3);
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  for (let i = 0; i < N; i++) {
    const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
    n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l;
  }
  return n;
}

// pos: Float32Array (meters), faces: triangle index list, V: cube size,
// box: optional { min:[x,y,z], max:[x,y,z] } to voxelize only a region,
// emit(tri): which triangles may produce visible cubes (others only close the surface)
export function voxelize(pos, faces, V, box = null, emit = null) {
  // bounds
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]);
  }
  if (box) { min = min.map((v, k) => Math.max(v, box.min[k])); max = max.map((v, k) => Math.min(v, box.max[k])); }
  // grid aligned to multiples of V (so detail and body grids line up), 2-cell margin
  const o = min.map((v) => Math.floor(v / V) * V - 2 * V);
  const dim = max.map((v, k) => Math.ceil((v - o[k]) / V) + 3);
  const [nx, ny, nz] = dim;
  const grid = new Uint8Array(nx * ny * nz); // 0 empty, 1 surface, 2 outside
  const cellOf = (x, y, z) => {
    const i = Math.floor((x - o[0]) / V), j = Math.floor((y - o[1]) / V), k = Math.floor((z - o[2]) / V);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
    return (k * ny + j) * nx + i;
  };
  const owner = new Map(); // cell -> [tri, u, v] (first triangle that touched it)

  // 1. surface
  for (let t = 0, f = 0; f < faces.length; f += 3, t++) {
    const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
    if (box) { // skip triangles fully outside the region
      let out = false;
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(pos[a + k], pos[b + k], pos[c + k]), hi = Math.max(pos[a + k], pos[b + k], pos[c + k]);
        if (hi < o[k] || lo > o[k] + dim[k] * V) out = true;
      }
      if (out) continue;
    }
    const e = Math.max(
      Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]),
      Math.hypot(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]),
      Math.hypot(pos[c] - pos[b], pos[c + 1] - pos[b + 1], pos[c + 2] - pos[b + 2]));
    const steps = Math.max(1, Math.ceil(e / (V * 0.45)));
    for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
      const u = i / steps, v = j / steps, w = 1 - u - v;
      const x = pos[a] * w + pos[b] * u + pos[c] * v;
      const y = pos[a + 1] * w + pos[b + 1] * u + pos[c + 1] * v;
      const z = pos[a + 2] * w + pos[b + 2] * u + pos[c + 2] * v;
      const cell = cellOf(x, y, z);
      if (cell < 0) continue;
      if (grid[cell] === 0) { grid[cell] = 1; owner.set(cell, [t, u, v]); }
      else if (emit && !emit(owner.get(cell)[0]) && emit(t)) owner.set(cell, [t, u, v]); // prefer visible triangles
    }
  }

  // 2. outside air: flood fill from the border (6 neighbors)
  const queue = new Int32Array(nx * ny * nz);
  let qh = 0, qt = 0;
  const pushIf = (c) => { if (grid[c] === 0) { grid[c] = 2; queue[qt++] = c; } };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { pushIf((k * ny + j) * nx); pushIf((k * ny + j) * nx + nx - 1); }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { pushIf((k * ny) * nx + i); pushIf((k * ny + ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { pushIf(j * nx + i); pushIf(((nz - 1) * ny + j) * nx + i); }
  const sx = 1, sy = nx, sz = nx * ny;
  while (qh < qt) {
    const c = queue[qh++];
    const i = c % nx, j = ((c / nx) | 0) % ny, k = (c / sz) | 0;
    if (i > 0) pushIf(c - sx); if (i < nx - 1) pushIf(c + sx);
    if (j > 0) pushIf(c - sy); if (j < ny - 1) pushIf(c + sy);
    if (k > 0) pushIf(c - sz); if (k < nz - 1) pushIf(c + sz);
  }

  // 3. shell cubes + crease shading
  const aoR = V <= 0.012 ? 2 : 1;
  const cubes = [];
  for (const [cell, [t, u, v]] of owner) {
    if (emit && !emit(t)) continue;
    const i = cell % nx, j = ((cell / nx) | 0) % ny, k = (cell / sz) | 0;
    const air = (c) => grid[c] === 2;
    if (!((i > 0 && air(cell - sx)) || (i < nx - 1 && air(cell + sx)) || (j > 0 && air(cell - sy)) ||
          (j < ny - 1 && air(cell + sy)) || (k > 0 && air(cell - sz)) || (k < nz - 1 && air(cell + sz)))) continue;
    let solid = 0, total = 0;
    for (let dk = -aoR; dk <= aoR; dk++) for (let dj = -aoR; dj <= aoR; dj++) for (let di = -aoR; di <= aoR; di++) {
      const I = i + di, Jj = j + dj, K = k + dk;
      if (I < 0 || Jj < 0 || K < 0 || I >= nx || Jj >= ny || K >= nz) continue;
      total++;
      if (grid[(K * ny + Jj) * nx + I] !== 2) solid++;
    }
    cubes.push({
      x: o[0] + (i + 0.5) * V, y: o[1] + (j + 0.5) * V, z: o[2] + (k + 0.5) * V,
      tri: t, u, v, occ: solid / total,
    });
  }
  return cubes;
}
