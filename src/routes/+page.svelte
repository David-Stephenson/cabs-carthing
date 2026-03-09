<script>
  import { onMount } from 'svelte';
  import {
    PUBLIC_DATA_URL,
    PUBLIC_MAPBOX_TOKEN,
    PUBLIC_MAP_STYLE,
    PUBLIC_MOUNT_HALL_STOP_ID,
    PUBLIC_ROUTE_URL
  } from '$env/static/public';

  let appEl;
  let mapEl;
  let statusEl;
  let tracker;
  let errors = [];

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

  onMount(() => {
    let disposed = false;

    const handleWindowError = (event) => {
      pushError(event.error || event.message || 'Unknown window error');
    };

    const handleUnhandledRejection = (event) => {
      pushError(event.reason || 'Unhandled promise rejection');
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    async function start() {
      try {
        const { createBusTracker } = await import('$lib/bus-tracker.js');
        if (disposed) {
          return;
        }

        tracker = createBusTracker({
          appEl,
          mapEl,
          statusEl,
          reportError: pushError,
          config: {
            dataUrl: PUBLIC_DATA_URL,
            routeUrl: PUBLIC_ROUTE_URL,
            mapStyle: PUBLIC_MAP_STYLE,
            mapboxToken: PUBLIC_MAPBOX_TOKEN,
            mountHallStopId: PUBLIC_MOUNT_HALL_STOP_ID || '501',
            busModelUrl: '/Bus.glb'
          }
        });
      } catch (error) {
        pushError(error);
      }
    }

    void start();

    return () => {
      disposed = true;
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      tracker?.destroy();
    };
  });
</script>

<svelte:head>
  <title>OSU Campus Bus Demo</title>
</svelte:head>

<div bind:this={appEl} id="app" class="relative h-screen min-h-[100dvh] w-screen overflow-hidden">
  {#if errors.length > 0}
    <aside class="error-panel">
      <div class="error-panel-header">
        <strong>Captured errors</strong>
        <button class="error-dismiss" type="button" on:click={dismissErrors}>Clear</button>
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

<style>
  #app {
    position: relative;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    margin: 0;
    padding: 0;
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
    width: min(520px, calc(100vw - 24px));
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
    align-items: baseline;
    gap: 4px;
    padding: 10px 16px;
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

  @media (max-width: 640px) {
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
</style>
