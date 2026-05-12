<script>
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { PUBLIC_MAPBOX_TOKEN, PUBLIC_MAP_STYLE } from '$env/static/public';

  let { data } = $props();

  let appEl = $state(/** @type {HTMLElement | undefined} */ (undefined));
  let mapEl = $state(/** @type {HTMLElement | undefined} */ (undefined));
  let statusEl = $state(/** @type {HTMLElement | undefined} */ (undefined));

  let errors = $state(/** @type {string[]} */ ([]));

  /** @type {import('$lib/bus-tracker.js').FleetRow[]} */
  let fleetRows = $state([]);

  function normalizeErrorMessage(input) {
    if (input instanceof Error) {
      return input.stack || input.message;
    }

    if (typeof input === 'string') {
      return input;
    }

    try {
      return JSON.stringify(input);
    } catch {
      return String(input);
    }
  }

  function pushError(message) {
    const normalized = normalizeErrorMessage(message);
    if (!normalized) {
      return;
    }

    errors = [normalized, ...errors.filter((entry) => entry !== normalized)].slice(0, 6);
  }

  function dismissErrors() {
    errors = [];
  }

  /** @param {import('$lib/bus-tracker.js').FleetRow} row */
  function formatEta(row) {
    if (row.seconds == null || !Number.isFinite(row.seconds)) {
      return '—';
    }
    if (row.countdownLabel && row.seconds <= 120) {
      return row.countdownLabel;
    }
    const mins = Math.max(0, Math.round(row.seconds / 60));
    return `${mins} min`;
  }

  /** @param {import('$lib/bus-tracker.js').FleetRow} row */
  function formatClock(row) {
    if (!row.predictionTime) {
      return '—';
    }
    try {
      return new Date(row.predictionTime).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch {
      return '—';
    }
  }

  let nextEtaIndex = $derived(
    fleetRows.findIndex((r) => r.seconds != null && Number.isFinite(r.seconds))
  );

  /** @param {Event & { currentTarget: HTMLSelectElement }} event */
  function onRouteChange(event) {
    const code = event.currentTarget.value;
    void goto(`/map?route=${encodeURIComponent(code)}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true
    });
  }

  /** @param {Event & { currentTarget: HTMLSelectElement }} event */
  function onStopChange(event) {
    const id = event.currentTarget.value;
    void goto(
      `/map?route=${encodeURIComponent(data.routeCode)}&stop=${encodeURIComponent(id)}`,
      {
        replaceState: true,
        keepFocus: true,
        noScroll: true
      }
    );
  }

  /** @type {ReturnType<typeof import('$lib/bus-tracker.js').createBusTracker> | undefined} */
  let tracker;

  /** Last config synced to `tracker` (seeded on first run after a tracker exists). */
  let prevStopId = /** @type {string | undefined} */ (undefined);
  let prevVehiclesUrl = /** @type {string | undefined} */ (undefined);
  let prevRouteShapesUrl = /** @type {string | undefined} */ (undefined);

  $effect(() => {
    if (!appEl || !mapEl || !statusEl) {
      return;
    }

    let disposed = false;

    const handleWindowError = (event) => {
      pushError(event.error || event.message || 'Unknown window error');
    };

    const handleUnhandledRejection = (event) => {
      pushError(event.reason || 'Unhandled promise rejection');
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    void (async () => {
      try {
        const { createBusTracker } = await import('$lib/bus-tracker.js');
        if (disposed) {
          return;
        }

        tracker = untrack(() => createBusTracker({
          appEl,
          mapEl,
          statusEl,
          reportError: pushError,
          onFleetUpdate: (rows) => {
            fleetRows = rows;
          },
          config: {
            dataUrl: data.vehiclesUrl,
            routeUrl: data.routeShapesUrl,
            mapStyle: PUBLIC_MAP_STYLE,
            mapboxToken: PUBLIC_MAPBOX_TOKEN,
            stopId: data.stopId,
            stopName: data.stopName,
            busModelUrl: '/Bus.glb'
          }
        }));
      } catch (error) {
        pushError(error);
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      tracker?.destroy();
      tracker = undefined;
      prevStopId = undefined;
      prevVehiclesUrl = undefined;
      prevRouteShapesUrl = undefined;
    };
  });

  $effect(() => {
    const stopId = data.stopId;
    const vehiclesUrl = data.vehiclesUrl;
    const routeShapesUrl = data.routeShapesUrl;
    const stopName = data.stopName;

    if (!tracker) return;

    if (prevStopId === undefined) {
      prevStopId = stopId;
      prevVehiclesUrl = vehiclesUrl;
      prevRouteShapesUrl = routeShapesUrl;
      return;
    }

    if (
      stopId === prevStopId &&
      vehiclesUrl === prevVehiclesUrl &&
      routeShapesUrl === prevRouteShapesUrl
    ) {
      return;
    }

    prevStopId = stopId;
    prevVehiclesUrl = vehiclesUrl;
    prevRouteShapesUrl = routeShapesUrl;

    tracker.updateConfig({
      dataUrl: vehiclesUrl,
      routeUrl: routeShapesUrl,
      stopId,
      stopName
    });
  });
</script>

<svelte:head>
  <title>{data.routeCode} · {data.stopName}</title>
</svelte:head>

<div class="map-page">
  <div bind:this={appEl} class="map-stage">
    {#if errors.length > 0}
    <aside class="error-panel">
      <div class="error-panel-header">
        <strong>Captured errors</strong>
        <button class="error-dismiss" type="button" onclick={dismissErrors}>Clear</button>
      </div>
      <ul class="error-list">
        {#each errors as error}
          <li>{error}</li>
        {/each}
      </ul>
    </aside>
  {/if}

  <div bind:this={statusEl} class="status" id="status">Loading live vehicles...</div>
  <div bind:this={mapEl} id="map"></div>
  </div>

  <aside class="fleet-panel" aria-label="Route, stop, and buses">
    <div class="fleet-panel-header">
      <h2 class="fleet-panel-title">Buses</h2>
      <p class="fleet-panel-hint">Next at this stop first</p>
    </div>
    <ul class="fleet-list">
      {#each fleetRows as row, i (row.vehicleId)}
        <li
          class="fleet-row"
          class:fleet-row--next={i === nextEtaIndex && nextEtaIndex >= 0}
          class:fleet-row--muted={row.seconds == null}
          animate:flip={{ duration: 300 }}
          transition:slide={{ duration: 250 }}
        >
          <div class="fleet-row-head">
            <span class="fleet-row-id">#{row.vehicleId}</span>
            {#if i === nextEtaIndex && nextEtaIndex >= 0}
              <span class="fleet-row-badge">Next</span>
            {/if}
            {#if row.isDelayed}
              <span class="fleet-row-delayed">Delayed</span>
            {/if}
          </div>
          {#if row.busId}
            <div class="fleet-row-meta">Bus {row.busId}</div>
          {/if}
          <div class="fleet-row-next-stop">
            <span class="fleet-row-next-label">Next stop</span>
            <span class="fleet-row-next-name">{row.nextStopName ?? '—'}</span>
          </div>
          {#if row.destination && row.destination !== row.nextStopName}
            <div class="fleet-row-dest" title={row.destination}>Toward {row.destination}</div>
          {/if}
          <div class="fleet-row-times">
            <span class="fleet-row-eta">{formatEta(row)}</span>
            <span class="fleet-row-clock">{formatClock(row)}</span>
          </div>
        </li>
      {:else}
        <li class="fleet-row fleet-row--empty">No buses on this route right now.</li>
      {/each}
    </ul>
    <div class="fleet-panel-footer">
      <div class="fleet-controls">
        <label class="fleet-field">
          <span class="fleet-field-label">Route</span>
          <select class="fleet-select" onchange={onRouteChange} aria-label="Bus route">
            {#each data.routes as route (route.code)}
              <option value={route.code} selected={route.code === data.routeCode}>
                {route.code} — {route.name}
              </option>
            {/each}
          </select>
        </label>
        <label class="fleet-field">
          <span class="fleet-field-label">Stop</span>
          <select class="fleet-select" onchange={onStopChange} aria-label="Bus stop">
            {#each data.stops as stop (stop.id)}
              <option value={String(stop.id)} selected={String(stop.id) === data.stopId}>
                {stop.name}
              </option>
            {/each}
          </select>
        </label>
      </div>
    </div>
  </aside>
</div>

<style>
  .map-page {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .map-stage {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .fleet-panel {
    width: min(18rem, 34vw);
    flex-shrink: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: #121218;
    color: #e4e4e7;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }

  .fleet-panel-header {
    flex-shrink: 0;
    padding: 12px 14px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .fleet-panel-footer {
    flex-shrink: 0;
    padding: 12px 14px 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(8, 8, 12, 0.65);
  }

  .fleet-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .fleet-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .fleet-field-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.45);
  }

  .fleet-select {
    width: 100%;
    box-sizing: border-box;
    appearance: none;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(16, 16, 22, 0.95);
    color: #f4f4f5;
    padding: 8px 10px;
    font-size: 13px;
    outline: none;
  }

  .fleet-select:focus {
    border-color: rgba(94, 234, 212, 0.45);
    box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.18);
  }

  .fleet-panel-title {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #a1a1aa;
  }

  .fleet-panel-hint {
    margin: 4px 0 0;
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.4);
  }

  .fleet-list {
    list-style: none;
    margin: 0;
    padding: 8px 10px 12px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .fleet-row {
    padding: 10px 10px;
    margin-bottom: 6px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .fleet-row--next {
    border-color: rgba(16, 185, 129, 0.35);
    background: rgba(16, 185, 129, 0.1);
  }

  .fleet-row--muted {
    opacity: 0.65;
  }

  .fleet-row--empty {
    font-size: 0.85rem;
    color: #a1a1aa;
    border: none;
    background: transparent;
  }

  .fleet-row-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .fleet-row-id {
    font-family: 'SF Mono', ui-monospace, Menlo, monospace;
    font-size: 0.88rem;
    font-weight: 700;
    color: #fff;
  }

  .fleet-row-badge {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(16, 185, 129, 0.25);
    color: #6ee7b7;
  }

  .fleet-row-delayed {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
  }

  .fleet-row-meta {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.45);
    margin-bottom: 2px;
  }

  .fleet-row-next-stop {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 6px;
  }

  .fleet-row-next-label {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.4);
  }

  .fleet-row-next-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: #f4f4f5;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .fleet-row-dest {
    font-size: 0.8rem;
    color: #d4d4d8;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 6px;
  }

  .fleet-row-times {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.8rem;
  }

  .fleet-row-eta {
    font-weight: 650;
    color: #fff;
  }

  .fleet-row-clock {
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.45);
    font-size: 0.78rem;
  }

  @media (max-width: 640px) {
    .map-page {
      flex-direction: column;
    }

    .fleet-panel {
      width: 100%;
      max-height: 38vh;
      border-left: none;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .error-panel {
      left: 12px;
      right: 12px;
      width: auto;
      max-height: 36vh;
    }

    .status {
      white-space: normal;
      flex-wrap: wrap;
      justify-content: flex-start;
    }

    :global(.hud-time) {
      padding: 8px 12px;
      gap: 2px;
    }

    :global(.hud-time-value) {
      font-size: 24px;
      letter-spacing: -0.5px;
    }

    :global(.hud-info) {
      padding: 8px 12px;
    }

    :global(.hud-action) {
      margin-left: 0;
      margin-right: 12px;
      margin-bottom: 8px;
    }
  }

  #map {
    height: 100%;
    width: 100%;
  }

  .status {
    position: absolute;
    bottom: 0;
    left: 0;
    z-index: 1000;
    background: rgba(10, 10, 14, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: #e8e8e8;
    padding: 0;
    border-radius: 0;
    font-family: system-ui, -apple-system, sans-serif;
    line-height: 1;
    width: 100%;
    box-shadow: 0 -2px 20px rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    white-space: nowrap;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .error-panel {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 1200;
    width: min(520px, calc(100% - 24px));
    max-height: min(45vh, 360px);
    overflow: auto;
    border: 1px solid rgba(248, 113, 113, 0.28);
    background: rgba(32, 12, 16, 0.92);
    color: #ffe4e6;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-radius: 12px;
    padding: 10px 12px;
    line-height: 1.35;
    pointer-events: auto;
  }

  .error-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .error-dismiss {
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 999px;
    padding: 4px 10px;
    font: inherit;
  }

  .error-list {
    margin: 0;
    padding-left: 18px;
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .error-list li + li {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  :global(.hud-time) {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 10px 16px;
  }

  :global(.hud-time-heading) {
    font-size: 9px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.35);
    letter-spacing: 0.6px;
    font-weight: 600;
  }

  :global(.hud-time-row) {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  :global(.hud-time-value) {
    font-size: 32px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -1px;
    line-height: 1;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }

  :global(.hud-time-unit) {
    font-size: 11px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.45);
    letter-spacing: 1px;
    font-weight: 600;
  }

  :global(.hud-sep) {
    width: 1px;
    align-self: stretch;
    background: rgba(255, 255, 255, 0.1);
  }

  :global(.hud-info) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 16px;
  }

  :global(.hud-info-row) {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  :global(.hud-info-label) {
    font-size: 9px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.35);
    letter-spacing: 0.6px;
    min-width: 28px;
  }

  :global(.hud-info-value) {
    color: #fff;
    font-weight: 500;
  }

  :global(.hud-action) {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 5px;
    letter-spacing: 0.3px;
    margin-left: auto;
    margin-right: 14px;
  }

  :global(.hud-action--go) {
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.25);
  }

  :global(.hud-action--warn) {
    background: rgba(251, 191, 36, 0.2);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.25);
  }

  :global(.hud-action--rush) {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.25);
  }

  :global(.hud-action--wait) {
    background: rgba(148, 163, 184, 0.12);
    color: #94a3b8;
    border: 1px solid rgba(148, 163, 184, 0.15);
  }

  :global(.stop-wrap) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    pointer-events: none;
  }

  :global(.stop-stem) {
    width: 1px;
    height: 14px;
    background: linear-gradient(to bottom, rgba(77, 166, 255, 0.85), rgba(77, 166, 255, 0.1));
    flex: 0 0 auto;
  }

  :global(.stop-dot) {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #ffffff 0%, #9ec9ff 45%, #2f80ff 100%);
    border: 1px solid rgba(255, 255, 255, 0.65);
    box-shadow:
      0 0 0 2px rgba(77, 166, 255, 0.18),
      0 1px 3px rgba(0, 0, 0, 0.35);
    flex: 0 0 auto;
  }

  :global(.stop-dot--red) {
    width: 11px;
    height: 11px;
    background: radial-gradient(circle at 35% 35%, #ffffff 0%, #ff9e9e 40%, #e63030 100%);
    border: 1px solid rgba(255, 255, 255, 0.7);
    box-shadow:
      0 0 0 2.5px rgba(230, 48, 48, 0.22),
      0 1px 4px rgba(0, 0, 0, 0.4);
  }

  :global(.stop-stem--red) {
    height: 18px;
    background: linear-gradient(to bottom, rgba(230, 48, 48, 0.85), rgba(230, 48, 48, 0.1));
  }

  :global(.mapboxgl-ctrl-attrib),
  :global(.mapboxgl-ctrl-bottom-right),
  :global(.mapboxgl-ctrl-logo) {
    display: none !important;
  }
</style>
