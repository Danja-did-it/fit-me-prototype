// Clothes from the photo: the colors of the front and back photo are projected onto the avatar
// (patterns, logos, folds, real shoe colors). Runs on this device, nothing is uploaded.
//
// The model was fitted in the pose of the photo. Its mesh points are put into that pose, aligned
// with the photo by the body points (scale from shoulder -> ankle height, center from the hips),
// and a depth buffer decides which points the camera really sees (no arm color on the belly).
// Each cube then takes the photo color at the position of its mesh triangle.
import { vertexNormals } from './voxelize.js';

const BODY = 13380;

function viewMap(avatar, pos, normals, W, scan, back, wb) {
  const { photo, landmarks: lm, mask } = scan;
  if (!photo) return null;
  const Wp = photo.width, Hp = photo.height;
  const P = (i) => ({ x: lm[i].x * Wp, y: lm[i].y * Hp });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const shP = mid(P(11), P(12)), anP = mid(P(27), P(28)), hipP = mid(P(23), P(24));
  const ys = (W.shoulderL[1] + W.shoulderR[1]) / 2, ya = (W.ankleL[1] + W.ankleR[1]) / 2;
  const s = (anP.y - shP.y) / (ys - ya); // pixels per meter
  const ty = shP.y + s * ys, tx = hipP.x;
  const dir = back ? -1 : 1; // the back photo sees the model mirrored and from behind
  // project all points + depth buffer (nearest point per 3 px cell)
  const n = BODY, px = new Float32Array(n), py = new Float32Array(n), dep = new Float32Array(n), C = 3;
  const gw = Math.ceil(Wp / C), gh = Math.ceil(Hp / C), zbuf = new Float32Array(gw * gh).fill(-Infinity);
  for (let v = 0; v < n; v++) {
    px[v] = tx + dir * s * pos[v * 3]; py[v] = ty - s * pos[v * 3 + 1]; dep[v] = dir * pos[v * 3 + 2];
    const gx = Math.floor(px[v] / C), gy = Math.floor(py[v] / C);
    if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) zbuf[gy * gw + gx] = Math.max(zbuf[gy * gw + gx], dep[v]);
  }
  const vis = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const gx = Math.floor(px[v] / C), gy = Math.floor(py[v] / C);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
    const facing = dir * normals[v * 3 + 2];
    if (dep[v] < zbuf[gy * gw + gx] - 0.025 || facing < 0.1) continue;
    vis[v] = Math.min(1, (facing - 0.1) / 0.3);
  }
  const maskAt = (x, y) => {
    const mx = Math.round((x / Wp) * mask.width), my = Math.round((y / Hp) * mask.height);
    return mx >= 0 && my >= 0 && mx < mask.width && my < mask.height ? mask.data[my * mask.width + mx] : 0;
  };
  const pix = photo.pixels;
  return {
    sample(a, b, c, w0, u, w) {
      const vw = vis[a] * w0 + vis[b] * u + vis[c] * w;
      if (vw < 0.05) return null;
      const x = px[a] * w0 + px[b] * u + px[c] * w, y = py[a] * w0 + py[b] * u + py[c] * w;
      if (maskAt(x, y) < 0.5) return null;
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 1 || yi < 1 || xi >= Wp - 1 || yi >= Hp - 1) return null;
      let r = 0, g = 0, bl = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const k = ((yi + j) * Wp + xi + i) * 4; r += pix[k]; g += pix[k + 1]; bl += pix[k + 2]; }
      return { rgb: [r / 9 * wb[0], g / 9 * wb[1], bl / 9 * wb[2]], weight: vw };
    },
  };
}

// scans: front / back photo scans; body: fitted measurements (pose angles); wb: white balance
export function buildBodyMap(avatar, scans, body, wb = [1, 1, 1]) {
  const front = scans.front.find((s) => s.view !== 'back' && s.photo), back = scans.front.find((s) => s.view === 'back' && s.photo);
  if (!front && !back) return null;
  const pose = [avatar.poseSpread, avatar.poseLegSpread];
  if (body.armAngle) { avatar.poseSpread = body.armAngle; avatar.poseLegSpread = body.legAngle; }
  const { pos, W } = avatar.shape();
  [avatar.poseSpread, avatar.poseLegSpread] = pose;
  const normals = vertexNormals(pos, avatar.H.faces, avatar.H.N);
  const views = [front && viewMap(avatar, pos, normals, W, front, false, wb), back && viewMap(avatar, pos, normals, W, back, true, wb)].filter(Boolean);
  return {
    // photo color (0xRRGGBB) + weight for a cube on triangle (a, b, c) with barycentric weights
    lookup(a, b, c, w0, u, w) {
      if (a >= BODY || b >= BODY || c >= BODY) return null;
      let r = 0, g = 0, bl = 0, ws = 0;
      for (const v of views) {
        const m = v.sample(a, b, c, w0, u, w);
        if (!m) continue;
        r += m.rgb[0] * m.weight; g += m.rgb[1] * m.weight; bl += m.rgb[2] * m.weight; ws += m.weight;
      }
      if (!ws) return null;
      const k = (x) => Math.max(0, Math.min(255, Math.round(x / ws)));
      return { color: (k(r) << 16) | (k(g) << 8) | k(bl), weight: Math.min(1, ws) };
    },
  };
}
