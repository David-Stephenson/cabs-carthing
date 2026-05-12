import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  BUS_MODEL_HEADING_OFFSET,
  BUS_MODEL_SCALE,
  FOLLOW_BEARING,
  FOLLOW_OFFSET,
  FOLLOW_PITCH,
  FOLLOW_ZOOM,
  LAYER,
  OSU_CENTER,
  REFRESH_MS
} from './bus/constants.js';
import { buildFleetRows, findArrivals, getActionMessage } from './bus/fleet.js';
import { decodePolyline, toRadians } from './bus/geo.js';
import {
  createRouteSnapper,
  getVehiclePoseFromSnap,
  normalizeHeading
} from './bus/route-snap.js';

/**
 * @typedef {{
 *   vehicleId: string;
 *   busId: string | null;
 *   destination: string | null;
 *   seconds: number | null;
 *   distanceFeet: number | null;
 *   predictionTime: string | null;
 *   isDelayed: boolean;
 *   countdownLabel: string | null;
 *   nextStopName: string | null;
 * }} FleetRow
 */

/**
 * Live Mapbox + Three.js bus corridor tracker for a single route/stop pair.
 *
 * @param {{
 *   appEl: HTMLElement;
 *   mapEl: HTMLElement;
 *   statusEl: HTMLElement;
 *   config: {
 *     dataUrl: string;
 *     routeUrl: string;
 *     mapStyle: string;
 *     mapboxToken: string;
 *     stopId: string;
 *     stopName?: string;
 *     busModelUrl: string;
 *   };
 *   reportError?: (message: string) => void;
 *   onFleetUpdate?: (fleet: FleetRow[]) => void;
 * }} options
 */
export function createBusTracker({
  appEl,
  mapEl,
  statusEl,
  config,
  reportError = () => {},
  onFleetUpdate = () => {}
}) {
  let dataUrl = config.dataUrl;
  let routeUrl = config.routeUrl;
  let targetStopId = String(config.stopId);
  let targetStopName = config.stopName ?? 'Selected stop';
  const busModelUrl = config.busModelUrl;
  const mapStyle = config.mapStyle;
  const mapboxToken = config.mapboxToken;

  /** @type {[number, number][][]} decoded corridor rings as [lng, lat][] */
  let routePaths = [];
  const { snapToRoute, resetPathTracker } = createRouteSnapper(() => routePaths);

  if (!mapboxToken) {
    reportError('Missing PUBLIC_MAPBOX_TOKEN in .env.');
    statusEl.innerHTML = `
      <strong>OSU Campus Bus Demo</strong>
      Missing <code>PUBLIC_MAPBOX_TOKEN</code> in <code>.env</code>.
    `;

    return {
      destroy() {},
      supportsDocumentPictureInPicture() {
        return false;
      },
      async togglePictureInPictureWindow() {}
    };
  }

  mapboxgl.accessToken = mapboxToken;
  const map = new mapboxgl.Map({
    container: mapEl,
    style: mapStyle,
    center: [OSU_CENTER[1], OSU_CENTER[0]],
    zoom: 14,
    pitch: FOLLOW_PITCH,
    bearing: FOLLOW_BEARING,
    attributionControl: false,
    interactive: false,
    antialias: true
  });

  const appHomeParent = appEl.parentElement;
  const appHomeNextSibling = appEl.nextSibling;
  let busScene = null;
  let busCamera = null;
  let busRenderer = null;
  let busLayer = null;
  let busModelTemplate = null;
  let busModelReady = false;
  /** @type {Map<string, { model: THREE.Object3D; isMain: boolean | null }>} */
  const busInstances = new Map();
  let allBusPoses = [];
  let mainBusId = null;
  let hasFitBounds = false;
  let hasRenderedRoute = false;
  let isMapLoaded = false;
  /** @type {unknown[] | null} */
  let pendingRoutePatterns = null;
  let stopMarkers = [];
  let nextRefreshAt = Date.now() + REFRESH_MS;
  let countdownTimer = null;
  let refreshTimer = null;
  let pipWindow = null;
  let isPipOpening = false;
  let mapResizeRaf = null;
  let resizeObserver = null;

  map.on('load', () => {
    isMapLoaded = true;

    if (pendingRoutePatterns) {
      renderRouteLines(pendingRoutePatterns);
      pendingRoutePatterns = null;
    }

    addBusLayerIfNeeded();
  });

  map.on('style.load', () => {
    addBusLayerIfNeeded();
  });

  map.on('error', (event) => {
    const message =
      event?.error?.message || event?.error?.toString?.() || 'Unknown Mapbox error';
    reportError(`Mapbox error: ${message}`);
  });

  async function fetchVehicles() {
    const response = await fetch(dataUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const payload = await response.json();
    return payload?.data?.vehicles ?? [];
  }

  async function fetchRouteData() {
    const response = await fetch(routeUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Route request failed: ${response.status}`);
    }
    const payload = await response.json();
    return {
      stops: payload?.data?.stops ?? [],
      patterns: payload?.data?.patterns ?? []
    };
  }

  function resolveStopLabel(stops) {
    const stop = stops.find((item) => String(item.id) === targetStopId);
    if (stop?.name) {
      targetStopName = stop.name;
    }
  }

  function renderStopLabels(stops) {
    if (stopMarkers.length > 0 || !stops.length) {
      return;
    }

    stopMarkers = stops.map((stop) => {
      const isSelected = String(stop.id) === targetStopId;

      const wrapper = document.createElement('div');
      wrapper.className = 'stop-wrap';

      const dot = document.createElement('div');
      dot.className = isSelected ? 'stop-dot stop-dot--red' : 'stop-dot';

      const stem = document.createElement('div');
      stem.className = isSelected ? 'stop-stem stop-stem--red' : 'stop-stem';

      wrapper.appendChild(dot);
      wrapper.appendChild(stem);

      return new mapboxgl.Marker({ element: wrapper, anchor: 'bottom' })
        .setLngLat([stop.longitude, stop.latitude])
        .addTo(map);
    });
  }

  function removeRouteLayers() {
    if (map.getLayer(LAYER.ROUTE_IB)) {
      map.removeLayer(LAYER.ROUTE_IB);
    }
    if (map.getLayer(LAYER.ROUTE_OB)) {
      map.removeLayer(LAYER.ROUTE_OB);
    }
    if (map.getSource(LAYER.ROUTE_SOURCE)) {
      map.removeSource(LAYER.ROUTE_SOURCE);
    }
  }

  function renderRouteLines(patterns) {
    if (hasRenderedRoute || patterns.length === 0) {
      return;
    }

    if (!isMapLoaded) {
      pendingRoutePatterns = patterns;
      return;
    }

    const decodedPatterns = patterns
      .filter((pattern) => pattern.encodedPolyline)
      .map((pattern) => ({
        direction: pattern.direction ?? 'unknown',
        coordinates: decodePolyline(pattern.encodedPolyline).map(([lat, lng]) => [lng, lat])
      }));

    routePaths = decodedPatterns.map((p) => p.coordinates);

    const features = decodedPatterns.map((p) => ({
      type: 'Feature',
      properties: {
        direction: p.direction
      },
      geometry: {
        type: 'LineString',
        coordinates: p.coordinates
      }
    }));

    if (features.length === 0) {
      return;
    }

    removeRouteLayers();

    map.addSource(LAYER.ROUTE_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features
      }
    });

    const styleLayers = map.getStyle().layers || [];
    let firstSymbolId = undefined;
    for (const layer of styleLayers) {
      if (layer.type === 'symbol') {
        firstSymbolId = layer.id;
        break;
      }
    }

    map.addLayer(
      {
        id: LAYER.ROUTE_IB,
        type: 'line',
        source: LAYER.ROUTE_SOURCE,
        filter: ['==', ['get', 'direction'], 'ib'],
        paint: {
          'line-color': '#0a8721',
          'line-width': 6,
          'line-opacity': 0.85
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      },
      firstSymbolId
    );

    map.addLayer(
      {
        id: LAYER.ROUTE_OB,
        type: 'line',
        source: LAYER.ROUTE_SOURCE,
        filter: ['==', ['get', 'direction'], 'ob'],
        paint: {
          'line-color': '#0f5cad',
          'line-width': 6,
          'line-opacity': 0.85
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        }
      },
      firstSymbolId
    );

    hasRenderedRoute = true;
    addBusLayerIfNeeded();
  }

  function getVehiclePose(vehicle) {
    return getVehiclePoseFromSnap(snapToRoute, vehicle);
  }

  function addBusLayerIfNeeded() {
    if (!isMapLoaded) {
      return;
    }

    if (map.getLayer(LAYER.BUS_3D)) {
      return;
    }

    if (!busLayer) {
      busLayer = createBusLayer();
    }

    map.addLayer(busLayer);
  }

  function createBusLayer() {
    return {
      id: LAYER.BUS_3D,
      type: 'custom',
      onAdd(layerMap, gl) {
        busScene = new THREE.Scene();
        busCamera = new THREE.Camera();
        busScene.add(new THREE.AmbientLight(0xffffff, 1));

        const loader = new GLTFLoader();
        loader.load(
          busModelUrl,
          (gltf) => {
            busModelTemplate = gltf.scene;
            busModelReady = true;
          },
          undefined,
          (error) => {
            reportError(
              `3D model failed to load: ${error?.message || error?.toString?.() || busModelUrl}`
            );
          }
        );

        busRenderer = new THREE.WebGLRenderer({
          canvas: layerMap.getCanvas(),
          context: gl,
          antialias: true
        });
        busRenderer.autoClear = false;
      },
      render(gl, matrix) {
        if (!busRenderer || !busScene || !busCamera || !busModelReady || !busModelTemplate) {
          return;
        }

        if (allBusPoses.length === 0) {
          return;
        }

        busRenderer.resetState();

        for (const pose of allBusPoses) {
          let instance = busInstances.get(pose.id);
          const isMain = pose.id === mainBusId;

          if (!instance) {
            const model = busModelTemplate.clone();
            instance = { model, isMain: null };
            busInstances.set(pose.id, instance);
            busScene.add(model);
          }

          if (instance.isMain !== isMain) {
            instance.isMain = isMain;
            instance.model.traverse((child) => {
              if (child.isMesh && child.material) {
                const material = child.material.clone();
                if (!isMain) {
                  material.color = new THREE.Color(0.85, 0.35, 0.35);
                  material.opacity = 0.85;
                  material.transparent = true;
                } else {
                  material.color = new THREE.Color(1, 1, 1);
                  material.opacity = 1;
                  material.transparent = false;
                }
                child.material = material;
              }
            });
          }
        }

        const mapMatrix = new THREE.Matrix4().fromArray(matrix);

        for (const pose of allBusPoses) {
          const instance = busInstances.get(pose.id);
          if (!instance) {
            continue;
          }

          busInstances.forEach((entry) => {
            entry.model.visible = false;
          });
          instance.model.visible = true;

          const mercator = mapboxgl.MercatorCoordinate.fromLngLat(
            { lng: pose.position[0], lat: pose.position[1] },
            0
          );
          const scale = mercator.meterInMercatorCoordinateUnits() * BUS_MODEL_SCALE;
          const heading = Number.isFinite(pose.heading) ? pose.heading : 0;
          const headingRad = toRadians(-heading + BUS_MODEL_HEADING_OFFSET);

          const modelMatrix = new THREE.Matrix4()
            .makeTranslation(mercator.x, mercator.y, mercator.z)
            .scale(new THREE.Vector3(scale, -scale, scale))
            .multiply(new THREE.Matrix4().makeRotationZ(headingRad))
            .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

          busCamera.projectionMatrix = mapMatrix.clone().multiply(modelMatrix);
          busRenderer.render(busScene, busCamera);
        }

        map.triggerRepaint();
      }
    };
  }

  function renderVehicles(vehicles, highlightId) {
    mainBusId = highlightId;
    const poses = [];

    vehicles.forEach((vehicle) => {
      const id = vehicle.id ?? `${vehicle.latitude},${vehicle.longitude}`;
      const pose = getVehiclePose(vehicle);
      poses.push({ ...pose, id });
    });

    allBusPoses = poses;

    const activeIds = new Set(poses.map((pose) => pose.id));
    busInstances.forEach((instance, id) => {
      if (!activeIds.has(id) && busScene) {
        busScene.remove(instance.model);
        busInstances.delete(id);
      }
    });
  }

  function findVehicleById(vehicles, vehicleId) {
    return vehicles.find((vehicle) => String(vehicle.id) === String(vehicleId)) ?? null;
  }

  function updateCountdown() {
    const countdownEl = document.getElementById('countdown');
    if (!countdownEl) {
      return;
    }

    const remainingMs = Math.max(0, nextRefreshAt - Date.now());
    const remainingSec = Math.ceil(remainingMs / 1000);
    countdownEl.textContent = `Refresh: ${remainingSec}s`;
  }

  function startCountdown() {
    if (countdownTimer) {
      return;
    }

    countdownTimer = window.setInterval(updateCountdown, 1000);
  }

  function supportsDocumentPictureInPicture() {
    return (
      'documentPictureInPicture' in window &&
      typeof window.documentPictureInPicture.requestWindow === 'function'
    );
  }

  function resizeMapAfterContainerMove() {
    map.resize();
    requestAnimationFrame(() => {
      map.resize();
    });
  }

  function queueMapResize() {
    if (mapResizeRaf !== null) {
      return;
    }

    mapResizeRaf = requestAnimationFrame(() => {
      mapResizeRaf = null;
      map.resize();
    });
  }

  function copyStylesToPipDocument(targetDoc) {
    const styleNodes = document.querySelectorAll('link[rel="stylesheet"], style');
    styleNodes.forEach((node) => {
      targetDoc.head.appendChild(node.cloneNode(true));
    });
  }

  function moveAppBackToMainWindow() {
    if (!appHomeParent || appEl.parentElement === appHomeParent) {
      return;
    }

    if (appHomeNextSibling && appHomeNextSibling.parentNode === appHomeParent) {
      appHomeParent.insertBefore(appEl, appHomeNextSibling);
    } else {
      appHomeParent.appendChild(appEl);
    }

    resizeMapAfterContainerMove();
  }

  async function openPictureInPictureWindow() {
    if (!supportsDocumentPictureInPicture() || isPipOpening) {
      return;
    }

    if (pipWindow && !pipWindow.closed) {
      pipWindow.focus();
      return;
    }

    isPipOpening = true;
    try {
      const rect = appEl.getBoundingClientRect();
      const pipWidth = Math.max(360, Math.round(rect.width));
      const pipHeight = Math.max(240, Math.round(rect.height));

      pipWindow = await window.documentPictureInPicture.requestWindow({
        width: pipWidth,
        height: pipHeight
      });

      copyStylesToPipDocument(pipWindow.document);
      pipWindow.document.body.style.margin = '0';
      pipWindow.document.body.style.overflow = 'hidden';
      pipWindow.document.body.appendChild(appEl);
      resizeMapAfterContainerMove();
      pipWindow.addEventListener('resize', queueMapResize);

      pipWindow.addEventListener(
        'pagehide',
        () => {
          moveAppBackToMainWindow();
          pipWindow = null;
        },
        { once: true }
      );
    } catch (error) {
      console.warn('Unable to open Picture-in-Picture window:', error);
    } finally {
      isPipOpening = false;
    }
  }

  async function togglePictureInPictureWindow() {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
      return;
    }

    await openPictureInPictureWindow();
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (target.isContentEditable) {
      return true;
    }

    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderStatus(arrivals) {
    const nextArrival = arrivals[0] ?? null;
    const followingArrival = arrivals[1] ?? null;

    const actionMessage = getActionMessage(nextArrival);
    nextRefreshAt = Date.now() + REFRESH_MS;

    const minutes = nextArrival ? Math.max(0, Math.round(nextArrival.seconds / 60)) : null;

    let actionClass = 'hud-action--wait';
    if (nextArrival) {
      const seconds = nextArrival.seconds;
      if (seconds <= 30) {
        actionClass = 'hud-action--wait';
      } else if (seconds <= 90) {
        actionClass = 'hud-action--rush';
      } else if (seconds <= 180) {
        actionClass = 'hud-action--warn';
      } else {
        actionClass = 'hud-action--go';
      }
    }

    const etaShort = nextArrival?.predictionTime
      ? new Date(nextArrival.predictionTime).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit'
        })
      : '--';

    const nextAfterShort = followingArrival?.predictionTime
      ? new Date(followingArrival.predictionTime).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit'
        })
      : '--';

    statusEl.innerHTML = `
      <div class="hud-time">
        <span class="hud-time-heading">How long away</span>
        <div class="hud-time-row">
          <span class="hud-time-value">${minutes !== null ? minutes : '--'}</span>
          <span class="hud-time-unit">min</span>
        </div>
      </div>
      <div class="hud-sep"></div>
      <div class="hud-info">
        <div class="hud-info-row">
          <span class="hud-info-label">Stop</span>
          <span class="hud-info-value">${escapeHtml(targetStopName)}</span>
        </div>
        <div class="hud-info-row">
          <span class="hud-info-label">ETA</span>
          <span class="hud-info-value">${etaShort}</span>
        </div>
        <div class="hud-info-row">
          <span class="hud-info-label">Next</span>
          <span class="hud-info-value">${nextAfterShort}</span>
        </div>
      </div>
      <span class="hud-action ${actionClass}">${actionMessage}</span>
    `;

    updateCountdown();
    startCountdown();
  }

  async function refresh() {
    try {
      const [vehicles, routeData] = await Promise.all([fetchVehicles(), fetchRouteData()]);
      resolveStopLabel(routeData.stops);
      renderStopLabels(routeData.stops);
      renderRouteLines(routeData.patterns);

      const arrivals = findArrivals(vehicles, targetStopId);
      const nextArrival = arrivals[0] ?? null;
      const nextVehicle = nextArrival ? findVehicleById(vehicles, nextArrival.vehicleId) : null;

      if (nextVehicle) {
        const pose = getVehiclePose(nextVehicle);
        const followCenter = pose.position;
        const followHeading = Number.isFinite(pose.heading)
          ? normalizeHeading(pose.heading)
          : map.getBearing();

        map.easeTo({
          center: followCenter,
          zoom: FOLLOW_ZOOM,
          pitch: FOLLOW_PITCH,
          bearing: followHeading,
          offset: FOLLOW_OFFSET,
          duration: hasFitBounds ? 2000 : 3000,
          easing: (t) => t * (2 - t)
        });
        hasFitBounds = true;
      }

      renderVehicles(vehicles, nextVehicle?.id ?? null);
      renderStatus(arrivals);
      onFleetUpdate(buildFleetRows(vehicles, targetStopId));
    } catch (error) {
      onFleetUpdate([]);
      reportError(
        `Refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      statusEl.innerHTML = `
        <strong>OSU Campus Bus Demo</strong>
        Error loading data: ${error instanceof Error ? error.message : 'Unknown error'}<br />
        If you opened this via file://, use <code>python -m http.server</code>.
      `;
    }
  }

  const keydownHandler = (event) => {
    if (event.code !== 'Space' || event.repeat || isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    void togglePictureInPictureWindow();
  };

  document.addEventListener('keydown', keydownHandler);
  refresh();
  refreshTimer = window.setInterval(refresh, REFRESH_MS);

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      queueMapResize();
    });
    resizeObserver.observe(appEl);
  }

  function updateConfig(newConfig) {
    const routeChanged =
      (newConfig.routeUrl && newConfig.routeUrl !== routeUrl) ||
      (newConfig.dataUrl && newConfig.dataUrl !== dataUrl);

    if (newConfig.dataUrl) dataUrl = newConfig.dataUrl;
    if (newConfig.routeUrl) routeUrl = newConfig.routeUrl;
    if (newConfig.stopId != null) targetStopId = String(newConfig.stopId);
    if (newConfig.stopName != null) targetStopName = newConfig.stopName;

    if (routeChanged) {
      stopMarkers.forEach((marker) => marker.remove());
      stopMarkers = [];
      hasRenderedRoute = false;
      routePaths = [];
      resetPathTracker();

      allBusPoses = [];
      busInstances.forEach((instance) => {
        if (busScene) busScene.remove(instance.model);
      });
      busInstances.clear();
      mainBusId = null;

      removeRouteLayers();
    } else {
      stopMarkers.forEach((marker) => marker.remove());
      stopMarkers = [];
    }

    hasFitBounds = false;
    if (refreshTimer) clearInterval(refreshTimer);
    refresh();
    refreshTimer = window.setInterval(refresh, REFRESH_MS);
  }

  return {
    supportsDocumentPictureInPicture,
    togglePictureInPictureWindow,
    updateConfig,
    destroy() {
      document.removeEventListener('keydown', keydownHandler);
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
      if (countdownTimer) {
        clearInterval(countdownTimer);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (mapResizeRaf !== null) {
        cancelAnimationFrame(mapResizeRaf);
      }
      if (pipWindow && !pipWindow.closed) {
        pipWindow.close();
      }

      onFleetUpdate([]);

      stopMarkers.forEach((marker) => marker.remove());
      stopMarkers = [];
      busInstances.forEach((instance) => {
        if (busScene) {
          busScene.remove(instance.model);
        }
      });
      busInstances.clear();
      busRenderer?.dispose();
      moveAppBackToMainWindow();
      map.remove();
    }
  };
}
