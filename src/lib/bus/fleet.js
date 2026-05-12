/**
 * @param {Record<string, unknown>} vehicle
 * @param {string} targetStopId
 */
export function pickPredictionForVehicle(vehicle, targetStopId) {
  const preds = Array.isArray(vehicle.predictions) ? vehicle.predictions : [];
  /** @type {Record<string, unknown> | null} */
  let best = null;
  let bestSec = Infinity;

  for (const p of preds) {
    if (String(p.stopId) !== targetStopId) {
      continue;
    }
    const sec = Number(p.timeToArrivalInSeconds);
    if (!Number.isFinite(sec)) {
      continue;
    }
    if (sec < bestSec) {
      bestSec = sec;
      best = p;
    }
  }

  return best;
}

/** Soonest prediction along the route (next stop the bus will serve). */
export function pickSoonestPrediction(vehicle) {
  const preds = Array.isArray(vehicle.predictions) ? vehicle.predictions : [];
  /** @type {Record<string, unknown> | null} */
  let best = null;
  let bestSec = Infinity;

  for (const p of preds) {
    const sec = Number(p.timeToArrivalInSeconds);
    if (!Number.isFinite(sec)) {
      continue;
    }
    if (sec < bestSec) {
      bestSec = sec;
      best = p;
    }
  }

  return best;
}

/**
 * Vehicles with a valid ETA to the selected stop, sorted by proximity / time.
 * @param {Record<string, unknown>[]} vehicles
 * @param {string} targetStopId
 */
export function findArrivals(vehicles, targetStopId) {
  const arrivals = [];

  vehicles.forEach((vehicle) => {
    const pred = pickPredictionForVehicle(vehicle, targetStopId);
    if (!pred) {
      return;
    }

    const seconds = Number(pred.timeToArrivalInSeconds);
    if (!Number.isFinite(seconds)) {
      return;
    }
    const distanceFeet = Number(pred.vehicleDistanceInFeet);

    arrivals.push({
      seconds,
      distanceFeet: Number.isFinite(distanceFeet) ? distanceFeet : null,
      vehicleId: vehicle.id ?? 'n/a',
      isDelayed: pred.isDelayed ?? false,
      predictionTime: pred.predictionTime ?? null
    });
  });

  arrivals.sort((a, b) => {
    if (Number.isFinite(a.distanceFeet) && Number.isFinite(b.distanceFeet)) {
      return a.distanceFeet - b.distanceFeet;
    }
    return a.seconds - b.seconds;
  });
  return arrivals;
}

/**
 * @param {Record<string, unknown>[]} vehicles
 * @param {string} targetStopId
 */
export function buildFleetRows(vehicles, targetStopId) {
  const rows = vehicles.map((vehicle) => {
    const vid = vehicle.id != null ? String(vehicle.id) : '';
    const pred = pickPredictionForVehicle(vehicle, targetStopId);
    const seconds = pred ? Number(pred.timeToArrivalInSeconds) : NaN;
    const distanceFeet = pred ? Number(pred.vehicleDistanceInFeet) : NaN;
    const soonest = pickSoonestPrediction(vehicle);
    const nextStopName =
      soonest?.stopName != null ? String(soonest.stopName) : null;

    return {
      vehicleId: vid || 'unknown',
      busId: vehicle.bus_id != null ? String(vehicle.bus_id) : null,
      destination: vehicle.destination != null ? String(vehicle.destination) : null,
      seconds: Number.isFinite(seconds) ? seconds : null,
      distanceFeet: Number.isFinite(distanceFeet) ? distanceFeet : null,
      predictionTime: pred?.predictionTime != null ? String(pred.predictionTime) : null,
      isDelayed: Boolean(pred?.isDelayed ?? vehicle.delayed),
      countdownLabel:
        pred?.predictionCountdown != null ? String(pred.predictionCountdown) : null,
      nextStopName
    };
  });

  rows.sort((a, b) => {
    const h1 = Number.isFinite(a.seconds);
    const h2 = Number.isFinite(b.seconds);
    if (h1 && h2) {
      if (
        Number.isFinite(a.distanceFeet) &&
        Number.isFinite(b.distanceFeet) &&
        a.distanceFeet !== b.distanceFeet
      ) {
        return a.distanceFeet - b.distanceFeet;
      }
      return a.seconds - b.seconds;
    }
    if (h1) {
      return -1;
    }
    if (h2) {
      return 1;
    }
    return a.vehicleId.localeCompare(b.vehicleId);
  });

  return rows;
}

/** Plain-language cue for the HUD chip under time pressure. */
export function getActionMessage(arrival) {
  if (!arrival || !Number.isFinite(arrival.seconds)) {
    return 'No guidance';
  }

  const seconds = Math.max(0, Math.round(arrival.seconds));
  if (seconds >= 240) {
    return 'Start packing';
  }
  if (seconds >= 120) {
    return 'Time to go';
  }
  if (seconds >= 90) {
    return 'You need to go now';
  }
  if (seconds <= 30) {
    return 'Forget it, wait for next one';
  }
  return 'Head out soon';
}
