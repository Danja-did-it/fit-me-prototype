// Procedural animations for the voxel avatar: idle, walk, squat.
//
// Each mode is a function of time that returns target angles (radians) for the joints.
// The Animator blends smoothly from the current pose to the target, so switching
// modes never jumps. Then it moves the hips so the lowest foot touches the floor.
//
// Angle conventions (the avatar faces +z, toward the camera):
//   hip/shoulder rotation.x < 0  -> limb swings forward
//   knee rotation.x > 0          -> lower leg bends backward (normal knee)
//   elbow rotation.x < 0         -> forearm bends forward (normal elbow)
//   spine/chest rotation.x > 0   -> upper body leans forward

const JOINTS = ['spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'];

// ---- Poses: return { joint: [x, y, z] } for time t (seconds) ----

function idle(t) {
  const breathe = Math.sin(t * 1.6);
  const sway = Math.sin(t * 0.7);
  return {
    spine: [0.01 * breathe, 0, 0.015 * sway],
    chest: [-0.02 * breathe, 0, -0.01 * sway],
    head: [0.03 * Math.sin(t * 0.5), 0.15 * Math.sin(t * 0.3), 0],
    shoulderL: [0.03 * sway, 0, 0.02 * breathe],
    shoulderR: [-0.03 * sway, 0, -0.02 * breathe],
    elbowL: [-0.08, 0, 0],
    elbowR: [-0.08, 0, 0],
    hipL: [0, 0, -0.015 * sway],
    hipR: [0, 0, -0.015 * sway],
  };
}

function walk(t) {
  const p = t * Math.PI * 2 * 0.9; // ~0.9 steps per second per leg
  const s = Math.sin(p), c = Math.cos(p);
  // knee bends while the leg swings forward (cos > 0), straight while standing on it
  const knee = (x) => 0.08 + 0.75 * Math.max(0, x);
  return {
    spine: [0.05, 0.08 * s, 0],
    chest: [0, -0.14 * s, 0],
    head: [0, 0.06 * s, 0],
    hipL: [-0.42 * s, 0, 0],
    hipR: [0.42 * s, 0, 0],
    kneeL: [knee(c), 0, 0],
    kneeR: [knee(-c), 0, 0],
    ankleL: [-0.15 * Math.max(0, c), 0, 0],
    ankleR: [-0.15 * Math.max(0, -c), 0, 0],
    shoulderL: [0.4 * s, 0, 0],
    shoulderR: [-0.4 * s, 0, 0],
    elbowL: [-0.25 - 0.2 * Math.max(0, -s), 0, 0],
    elbowR: [-0.25 - 0.2 * Math.max(0, s), 0, 0],
  };
}

// depth of the squat 0..1 (smooth down/up, short pause at the bottom and top)
function squatDepth(t) {
  const x = (Math.sin(t * Math.PI * 2 * 0.35 - Math.PI / 2) + 1) / 2;
  return x * x * (3 - 2 * x);
}

function squat(t) {
  const d = squatDepth(t);
  const a = 1.35 * d;  // thigh angle forward from vertical
  const b = 0.6 * d;   // shin angle (knees move forward over the toes)
  return {
    hipL: [-a, 0, 0.06 * d],
    hipR: [-a, 0, -0.06 * d],
    kneeL: [a + b, 0, 0],
    kneeR: [a + b, 0, 0],
    ankleL: [-b, 0, 0],
    ankleR: [-b, 0, 0],
    spine: [0.45 * d, 0, 0], // lean forward to keep balance
    chest: [0.1 * d, 0, 0],
    head: [-0.45 * d, 0, 0], // keep looking ahead
    shoulderL: [-1.35 * d - 0.45 * d, 0, 0], // arms reach forward
    shoulderR: [-1.35 * d - 0.45 * d, 0, 0],
    elbowL: [-0.05, 0, 0],
    elbowR: [-0.05, 0, 0],
  };
}

const MODES = { idle, walk, squat };

export class Animator {
  constructor(avatar) {
    this.avatar = avatar;
    this.mode = 'idle';
    this.time = 0;
  }

  update(dt) {
    this.time += dt;
    const J = this.avatar.joints;
    if (!J.hips) return; // body data still loading
    const target = MODES[this.mode](this.time);
    // blend toward target: fast enough to follow, smooth on mode changes
    const k = 1 - Math.exp(-dt * 12);
    for (const name of JOINTS) {
      const j = J[name];
      if (!j) continue;
      const [x, y, z] = target[name] || [0, 0, 0];
      // arms keep their resting spread away from the body
      const zz = name === 'shoulderL' ? z + this.avatar.armSpread
        : name === 'shoulderR' ? z - this.avatar.armSpread : z;
      j.rotation.x += (x - j.rotation.x) * k;
      j.rotation.y += (y - j.rotation.y) * k;
      j.rotation.z += (zz - j.rotation.z) * k;
    }
    this.placeOnFloor();
  }

  // Put the hips at the height where the lower foot just touches the ground,
  // and (for the squat) move them back so the feet stay in place.
  placeOnFloor() {
    const { joints: J, lengths: L } = this.avatar;
    let hipHeight = 0, footZ = 0;
    for (const side of ['L', 'R']) {
      const a = J['hip' + side].rotation.x;           // thigh angle
      const b = a + J['knee' + side].rotation.x;      // shin angle (world)
      const h = L.thigh * Math.cos(a) + L.calf * Math.cos(b) + L.foot;
      if (h > hipHeight) {
        hipHeight = h;
        // forward offset of the ankle relative to the hip (standing leg)
        footZ = -L.thigh * Math.sin(a) - L.calf * Math.sin(b);
      }
    }
    J.hips.position.y = hipHeight;
    // only the squat keeps feet fixed; while walking we step on the spot
    J.hips.position.z = this.mode === 'squat' ? -footZ : J.hips.position.z * 0.9;
  }
}
