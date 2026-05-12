/**
 * OSU polyline uses the standard encoded polyline algorithm (lat/lng order).
 * @param {string} encoded
 * @returns {[number, number][]} [lat, lng] pairs
 */
export function decodePolyline(encoded) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = null;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push([lat * 1e-5, lng * 1e-5]);
  }

  return coordinates;
}

export function toRadians(value) {
  return (value * Math.PI) / 180;
}

export function toDegrees(value) {
  return (value * 180) / Math.PI;
}

export function distanceMeters(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const x = toRadians(lng2 - lng1) * Math.cos(toRadians((lat1 + lat2) / 2));
  const y = toRadians(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * R;
}

/**
 * @param {[number, number]} point [lng, lat]
 * @param {[number, number]} start [lng, lat]
 * @param {[number, number]} end [lng, lat]
 */
export function projectToSegment(point, start, end) {
  const ax = start[0];
  const ay = start[1];
  const bx = end[0];
  const by = end[1];
  const px = point[0];
  const py = point[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return { point: [ax, ay], t: 0, dist: distanceMeters(px, py, ax, ay) };
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projection = [ax + t * dx, ay + t * dy];
  const dist = distanceMeters(px, py, projection[0], projection[1]);
  return { point: projection, t, dist };
}

export function bearingDegrees(start, end) {
  const lat1 = toRadians(start[1]);
  const lat2 = toRadians(end[1]);
  const dLng = toRadians(end[0] - start[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}
