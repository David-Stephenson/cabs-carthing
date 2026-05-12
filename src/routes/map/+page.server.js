import { error, redirect } from '@sveltejs/kit';

import {
  needsCanonicalRedirect,
  resolveRouteCode,
  resolveStopId,
  ROUTES_JSON_BASE
} from '$lib/osu-bus/routes-api.js';

/** @param {import('./$types').PageServerLoad} event */
export async function load({ url, fetch }) {
  const routesRes = await fetch(ROUTES_JSON_BASE, {
    headers: { Accept: 'application/json' }
  });

  if (!routesRes.ok) {
    throw error(routesRes.status, `Could not load bus routes (${routesRes.status})`);
  }

  const routesPayload = await routesRes.json();
  const routes = routesPayload?.data?.routes ?? [];

  if (!routes.length) {
    throw error(503, 'No bus routes returned from OSU content API');
  }

  const canonicalCodes = new Set(routes.map((r) => r.code));
  const rawRouteParam = url.searchParams.get('route');
  const routeCode = resolveRouteCode(routes, rawRouteParam ?? null);

  const detailRes = await fetch(`${ROUTES_JSON_BASE}/${routeCode}`, {
    headers: { Accept: 'application/json' }
  });

  if (!detailRes.ok) {
    throw error(detailRes.status, `Could not load route ${routeCode} (${detailRes.status})`);
  }

  const detailPayload = await detailRes.json();
  const stops = detailPayload?.data?.stops ?? [];

  if (!stops.length) {
    throw error(503, `Route ${routeCode} has no stops in the API response`);
  }

  const stopIds = new Set(stops.map((s) => String(s.id)));
  const rawStopParam = url.searchParams.get('stop');
  const stopId = resolveStopId(stops, rawStopParam);

  const rawRoute = rawRouteParam?.trim().toUpperCase() ?? null;
  const rawStop = rawStopParam?.trim() ?? null;

  if (
    needsCanonicalRedirect({
      rawRoute,
      rawStop,
      routeCode,
      stopId,
      canonicalCodes,
      stopIds
    })
  ) {
    const qs = new URLSearchParams({ route: routeCode, stop: stopId });
    throw redirect(302, `/map?${qs.toString()}`);
  }

  const selectedStop = stops.find((s) => String(s.id) === stopId) ?? stops[0];

  return {
    routes,
    routeCode,
    stops,
    stopId,
    stopName: selectedStop.name ?? `Stop ${stopId}`,
    vehiclesUrl: `${ROUTES_JSON_BASE}/${routeCode}/vehicles`,
    routeShapesUrl: `${ROUTES_JSON_BASE}/${routeCode}`
  };
}
