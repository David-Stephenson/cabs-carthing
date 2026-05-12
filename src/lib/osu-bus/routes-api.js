/** Base URL for OSU Campus Connector route metadata (public JSON API). */
export const ROUTES_JSON_BASE = 'https://content.osu.edu/v2/bus/routes';

/**
 * @param {Iterable<{ code?: string }>} routes
 * @param {string | null} requested upper-case route code from query string
 * @param {string} preferredDefault e.g. CC for Campus Connector
 */
export function resolveRouteCode(routes, requested, preferredDefault = 'CC') {
  const list = Array.from(routes);
  const canonicalCodes = new Set(list.map((r) => r.code).filter(Boolean));

  const upper = requested?.trim().toUpperCase() ?? null;
  const fromQuery = upper && canonicalCodes.has(upper) ? upper : null;

  if (fromQuery) {
    return fromQuery;
  }
  if (canonicalCodes.has(preferredDefault)) {
    return preferredDefault;
  }
  const first = list[0]?.code;
  if (!first) {
    throw new Error('resolveRouteCode: empty routes list');
  }
  return String(first);
}

/**
 * @param {{ id?: string | number }[]} stops
 * @param {string | null} requestedStopId from query string
 */
export function resolveStopId(stops, requestedStopId) {
  const stopIds = new Set(stops.map((s) => String(s.id)));
  const raw = requestedStopId?.trim() ?? null;
  if (raw && stopIds.has(raw)) {
    return raw;
  }
  return String(stops[0].id);
}

/**
 * Whether query params match canonical route/stop so we can skip a redirect.
 * @param {{
 *   rawRoute: string | null;
 *   rawStop: string | null;
 *   routeCode: string;
 *   stopId: string;
 *   canonicalCodes: Set<string>;
 *   stopIds: Set<string>;
 * }} args
 */
export function needsCanonicalRedirect(args) {
  const {
    rawRoute,
    rawStop,
    routeCode,
    stopId,
    canonicalCodes,
    stopIds
  } = args;

  const requestedRouteOk = Boolean(rawRoute && canonicalCodes.has(rawRoute.trim().toUpperCase()));
  const requestedStopOk = Boolean(rawStop && stopIds.has(rawStop.trim()));

  return (
    !requestedRouteOk ||
    !requestedStopOk ||
    rawRoute?.trim().toUpperCase() !== routeCode ||
    String(rawStop ?? '') !== stopId
  );
}
