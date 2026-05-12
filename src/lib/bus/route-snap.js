import { SNAP } from './constants.js';
import {
  bearingDegrees,
  distanceMeters,
  projectToSegment,
  toRadians
} from './geo.js';

/**
 * Keeps vehicles visually aligned to the drawn corridor while tolerating GPS noise.
 * @param {() => [number, number][][]} getPaths lng/lat rings derived from API polylines
 */
export function createRouteSnapper(getPaths) {
  const pathTracker = {
    pathIdx: -1,
    segIdx: 0
  };

  function findClosestSnap(position) {
    const routePaths = getPaths();
    let best = null;

    routePaths.forEach((path, pathIdx) => {
      for (let i = 0; i < path.length - 1; i += 1) {
        const projection = projectToSegment(position, path[i], path[i + 1]);
        if (!best || projection.dist < best.dist) {
          best = {
            dist: projection.dist,
            point: projection.point,
            pathIdx,
            segIdx: i,
            path
          };
        }
      }
    });
    return best;
  }

  function forwardLookingHeading(path, segIdx, fromPoint, meters) {
    let remaining = meters;
    let current = fromPoint;

    for (let i = segIdx; i < path.length - 1; i += 1) {
      const next = path[i + 1];
      const start = i === segIdx ? current : path[i];
      const segDist = distanceMeters(start[0], start[1], next[0], next[1]);

      if (segDist >= remaining && segDist > 0) {
        const fraction = remaining / segDist;
        const aheadPoint = [
          start[0] + (next[0] - start[0]) * fraction,
          start[1] + (next[1] - start[1]) * fraction
        ];
        return bearingDegrees(fromPoint, aheadPoint);
      }

      remaining -= segDist;
      current = next;
    }

    const lastPoint = path[path.length - 1];
    if (distanceMeters(fromPoint[0], fromPoint[1], lastPoint[0], lastPoint[1]) > 1) {
      return bearingDegrees(fromPoint, lastPoint);
    }

    return bearingDegrees(path[segIdx], path[Math.min(segIdx + 1, path.length - 1)]);
  }

  function computeSnapResult(path, segIdx, point) {
    const heading = forwardLookingHeading(path, segIdx, point, SNAP.LOOK_AHEAD_METERS);
    return { position: point, heading };
  }

  /**
   * @param {[number, number]} position [lng, lat]
   * @returns {{ position: [number, number]; heading: number } | null}
   */
  function snapToRoute(position) {
    const routePaths = getPaths();
    if (!routePaths.length) {
      return null;
    }

    const global = findClosestSnap(position);
    if (!global || global.dist > SNAP.MAX_ROUTE_DISTANCE_M) {
      pathTracker.pathIdx = -1;
      return null;
    }

    if (pathTracker.pathIdx < 0 || pathTracker.pathIdx >= routePaths.length) {
      pathTracker.pathIdx = global.pathIdx;
      pathTracker.segIdx = global.segIdx;
    }

    const trackedPath = routePaths[pathTracker.pathIdx];
    const low = Math.max(0, pathTracker.segIdx - SNAP.SEGMENT_SEARCH_BACK);
    const high = Math.min(trackedPath.length - 2, pathTracker.segIdx + SNAP.SEGMENT_SEARCH_FORWARD);

    let localBest = null;
    for (let i = low; i <= high; i += 1) {
      const projection = projectToSegment(position, trackedPath[i], trackedPath[i + 1]);
      if (!localBest || projection.dist < localBest.dist) {
        localBest = {
          dist: projection.dist,
          point: projection.point,
          segIdx: i
        };
      }
    }

    if (!localBest || localBest.dist > global.dist + SNAP.PATH_SWITCH_THRESHOLD_M) {
      pathTracker.pathIdx = global.pathIdx;
      pathTracker.segIdx = global.segIdx;
      return computeSnapResult(global.path, global.segIdx, global.point);
    }

    pathTracker.segIdx = localBest.segIdx;
    return computeSnapResult(trackedPath, localBest.segIdx, localBest.point);
  }

  function resetPathTracker() {
    pathTracker.pathIdx = -1;
    pathTracker.segIdx = 0;
  }

  return { snapToRoute, resetPathTracker };
}

export function normalizeHeading(heading) {
  if (!Number.isFinite(heading)) {
    return 0;
  }
  const normalized = heading % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function angleDifference(a, b) {
  const diff = Math.abs(normalizeHeading(a) - normalizeHeading(b));
  return Math.min(diff, 360 - diff);
}

/**
 * @param {ReturnType<typeof createRouteSnapper>['snapToRoute']} snapToRoute
 */
export function getVehiclePoseFromSnap(snapToRoute, vehicle) {
  const id = vehicle.id ?? `${vehicle.latitude},${vehicle.longitude}`;
  const rawPosition = [vehicle.longitude, vehicle.latitude];
  const snapped = snapToRoute(rawPosition);
  const position = snapped ? snapped.position : rawPosition;
  let heading = vehicle.heading;

  if (snapped) {
    const routeHeading = snapped.heading;
    const flipped = normalizeHeading(routeHeading + 180);
    if (Number.isFinite(heading)) {
      heading =
        angleDifference(routeHeading, heading) <= angleDifference(flipped, heading)
          ? routeHeading
          : flipped;
    } else {
      heading = routeHeading;
    }
  }

  return {
    id,
    position,
    heading: Number.isFinite(heading) ? heading : null
  };
}
