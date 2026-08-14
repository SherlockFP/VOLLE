/** Pure swept tests used by the fixed-step Volleyball controller. */

const EPSILON = 1e-8;

export function sweepVolleyballFloor(from, to, radius, floorY = 0, out = { hit: false, t: 1, x: 0, y: 0, z: 0 }) {
  const plane = floorY + radius;
  const start = from.y - plane;
  const end = to.y - plane;
  out.hit = false;
  out.t = 1;
  if (start < 0 || (start >= 0 && end <= 0)) {
    const denom = start - end;
    const t = start < 0 ? 0 : (Math.abs(denom) < EPSILON ? 0 : start / denom);
    out.hit = true;
    out.t = Math.max(0, Math.min(1, t));
    out.x = from.x + (to.x - from.x) * out.t;
    out.y = plane;
    out.z = from.z + (to.z - from.z) * out.t;
  }
  return out;
}

/** Sweeps a sphere against the finite vertical net slab centered on z=centerLine. */
export function sweepVolleyballNet(from, to, radius, options, out = { hit: false, t: 1, x: 0, y: 0, z: 0 }) {
  const center = options?.centerLine ?? 0;
  const halfThickness = (options?.netThickness ?? 0.08) * 0.5 + radius;
  const start = from.z - center;
  const end = to.z - center;
  out.hit = false;
  out.t = 1;

  if ((start > halfThickness && end > halfThickness) || (start < -halfThickness && end < -halfThickness)) return out;
  if (Math.abs(to.z - from.z) < EPSILON && Math.abs(start) > halfThickness) return out;

  let targetPlane = 0;
  if (start > halfThickness) targetPlane = halfThickness;
  else if (start < -halfThickness) targetPlane = -halfThickness;
  else targetPlane = start;
  const denom = to.z - from.z;
  const t = Math.abs(denom) < EPSILON ? 0 : (center + targetPlane - from.z) / denom;
  if (t < 0 || t > 1) return out;

  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  const netHalfWidth = options?.netHalfWidth ?? 9.5;
  const netHeight = options?.netHeight ?? 2.43;
  if (Math.abs(x) > netHalfWidth + radius || y - radius > netHeight || y + radius < 0) return out;

  out.hit = true;
  out.t = t;
  out.x = x;
  out.y = y;
  out.z = center + targetPlane;
  return out;
}

/** A line is in: any part of the ball footprint touching the boundary is in. */
export function isVolleyballLandingInBounds(position, radius, courtHalfWidth, courtHalfLength, epsilon = 1e-7) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return false;
  const r = Math.max(0, Number.isFinite(radius) ? radius : 0);
  return Math.abs(position.x) - r <= courtHalfWidth + epsilon
    && Math.abs(position.z) - r <= courtHalfLength + epsilon;
}

export function classifyVolleyballLanding(position, radius, courtHalfWidth, courtHalfLength, lineWidth = 0.05) {
  if (!isVolleyballLandingInBounds(position, radius, courtHalfWidth, courtHalfLength)) return 'out';
  const r = Math.max(0, Number.isFinite(radius) ? radius : 0);
  const footprintX = Math.abs(position.x) - r;
  const footprintZ = Math.abs(position.z) - r;
  return footprintX >= courtHalfWidth - lineWidth || footprintZ >= courtHalfLength - lineWidth
    ? 'line_in' : 'in';
}

export function integrateVolleyballBall(ball, gravity, dt) {
  ball.vy += gravity * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;
  return ball;
}

/** Resolves a playable, energy-losing ball/net collision in-place. */
export function resolveVolleyballNetRebound(ball, hit, incomingZVelocity, options) {
  const center = options?.centerLine ?? 0;
  const halfThickness = (options?.netThickness ?? 0.08) * 0.5 + ball.radius;
  const side = incomingZVelocity >= 0 ? -1 : 1;
  ball.x = hit.x;
  ball.y = hit.y;
  ball.z = center + side * (halfThickness + 1e-5);
  ball.vx *= options?.netTangentialDamping ?? 0.84;
  ball.vy *= options?.netTangentialDamping ?? 0.84;
  ball.vz = -incomingZVelocity * (options?.netRestitution ?? 0.38);
  return ball;
}
