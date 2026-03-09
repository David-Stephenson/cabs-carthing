import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * @param {{
 *   appEl: HTMLElement;
 *   mapEl: HTMLElement;
 *   statusEl: HTMLElement;
 *   config: {
 *     dataUrl: string;
 *     routeUrl: string;
 *     mapStyle: string;
 *     mapboxToken: string;
 *     mountHallStopId: string;
 *     busModelUrl: string;
 *   };
 * }} options
 */
export function createBusTracker({ appEl, mapEl, statusEl, config }) {
  const DATA_URL = config.dataUrl;
  const ROUTE_URL = config.routeUrl;
  const REFRESH_MS = 10000;
  const OSU_CENTER = [40.0054, -83.0305];
  const MOUNT_HALL_STOP_ID = config.mountHallStopId;
  const FOLLOW_ZOOM = 16.5;
  const FOLLOW_PITCH = 55;
  const FOLLOW_BEARING = 0;
  const FOLLOW_OFFSET = [0, 100];
  const BUS_MODEL_URL = config.busModelUrl;
  const BUS_MODEL_SCALE = 0.25;
  const BUS_MODEL_HEADING_OFFSET = 180;
  const MAP_STYLE = config.mapStyle;
  const MAPBOX_TOKEN = config.mapboxToken;

  if (!MAPBOX_TOKEN) {
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

  mapboxgl.accessToken = MAPBOX_TOKEN;
  const map = new mapboxgl.Map({
    container: mapEl,
    style: MAP_STYLE,
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
  /** @type {Map<string, {model: THREE.Object3D, isMain: boolean | null}>} */
  const busInstances = new Map();
  let allBusPoses = [];
  let mainBusId = null;
  let hasFitBounds = false;
  let mountHallName = 'Mount Hall Loop';
  let hasRenderedRoute = false;
  let isMapLoaded = false;
  let pendingRoutePatterns = null;
  let routePaths = [];
  let stopMarkers = [];
  let nextRefreshAt = Date.now() + REFRESH_MS;
  let countdownTimer = null;
  let refreshTimer = null;
  let pipWindow = null;
  let isPipOpening = false;
  let mapResizeRaf = null;
  let resizeObserver = null;

  const pathTracker = {
    pathIdx: -1,
    segIdx: 0
  };

  map.on('load', () => {
    isMapLoaded = true;
    map.setPitch(FOLLOW_PITCH);
    map.setBearing(FOLLOW_BEARING);

    if (pendingRoutePatterns) {
      renderRouteLines(pendingRoutePatterns);
      pendingRoutePatterns = null;
    }

    addBusLayerIfNeeded();
  });

  map.on('style.load', () => {
    addBusLayerIfNeeded();
  });

  async function fetchVehicles() {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const payload = await response.json();
    return payload?.data?.vehicles ?? [];
  }

  async function fetchRouteData() {
    const response = await fetch(ROUTE_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Route request failed: ${response.status}`);
    }
    const payload = await response.json();
    return {
      stops: payload?.data?.stops ?? [],
      patterns: payload?.data?.patterns ?? []
    };
  }

  function renderMountHallStop(stops) {
    const stop = stops.find((item) => item.id === MOUNT_HALL_STOP_ID);
    if (!stop) {
      return;
    }
    mountHallName = stop.name ?? mountHallName;
  }

  function renderStopLabels(stops) {
    if (stopMarkers.length > 0 || !stops.length) {
      return;
    }

    stopMarkers = stops.map((stop) => {
      const isMountHall = stop.id === MOUNT_HALL_STOP_ID;

      const wrapper = document.createElement('div');
      wrapper.className = 'stop-wrap';

      const dot = document.createElement('div');
      dot.className = isMountHall ? 'stop-dot stop-dot--red' : 'stop-dot';

      const stem = document.createElement('div');
      stem.className = isMountHall ? 'stop-stem stop-stem--red' : 'stop-stem';

      wrapper.appendChild(dot);
      wrapper.appendChild(stem);

      return new mapboxgl.Marker({ element: wrapper, anchor: 'bottom' })
        .setLngLat([stop.longitude, stop.latitude])
        .addTo(map);
    });
  }

  function decodePolyline(encoded) {
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

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function toDegrees(value) {
    return (value * 180) / Math.PI;
  }

  function distanceMeters(lng1, lat1, lng2, lat2) {
    const R = 6371000;
    const x = toRadians(lng2 - lng1) * Math.cos(toRadians((lat1 + lat2) / 2));
    const y = toRadians(lat2 - lat1);
    return Math.sqrt(x * x + y * y) * R;
  }

  function projectToSegment(point, start, end) {
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

  function bearingDegrees(start, end) {
    const lat1 = toRadians(start[1]);
    const lat2 = toRadians(end[1]);
    const dLng = toRadians(end[0] - start[0]);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
  }

  function findClosestSnap(position) {
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
    const LOOK_AHEAD_METERS = 40;
    const heading = forwardLookingHeading(path, segIdx, point, LOOK_AHEAD_METERS);
    return { position: point, heading };
  }

  function snapToRoute(position) {
    if (!routePaths.length) {
      return null;
    }

    const global = findClosestSnap(position);
    if (!global || global.dist > 60) {
      pathTracker.pathIdx = -1;
      return null;
    }

    if (pathTracker.pathIdx < 0 || pathTracker.pathIdx >= routePaths.length) {
      pathTracker.pathIdx = global.pathIdx;
      pathTracker.segIdx = global.segIdx;
    }

    const trackedPath = routePaths[pathTracker.pathIdx];
    const searchBack = 3;
    const searchFwd = 15;
    const low = Math.max(0, pathTracker.segIdx - searchBack);
    const high = Math.min(trackedPath.length - 2, pathTracker.segIdx + searchFwd);

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

    const PATH_SWITCH_THRESHOLD = 30;
    if (!localBest || localBest.dist > global.dist + PATH_SWITCH_THRESHOLD) {
      pathTracker.pathIdx = global.pathIdx;
      pathTracker.segIdx = global.segIdx;
      return computeSnapResult(global.path, global.segIdx, global.point);
    }

    pathTracker.segIdx = localBest.segIdx;
    return computeSnapResult(trackedPath, localBest.segIdx, localBest.point);
  }

  function renderRouteLines(patterns) {
    if (hasRenderedRoute || patterns.length === 0) {
      return;
    }

    if (!isMapLoaded) {
      pendingRoutePatterns = patterns;
      return;
    }

    routePaths = patterns
      .filter((pattern) => pattern.encodedPolyline)
      .map((pattern) =>
        decodePolyline(pattern.encodedPolyline).map(([lat, lng]) => [lng, lat])
      );

    const features = patterns
      .filter((pattern) => pattern.encodedPolyline)
      .map((pattern) => ({
        type: 'Feature',
        properties: {
          direction: pattern.direction ?? 'unknown'
        },
        geometry: {
          type: 'LineString',
          coordinates: decodePolyline(pattern.encodedPolyline).map(([lat, lng]) => [lng, lat])
        }
      }));

    if (features.length === 0) {
      return;
    }

    if (map.getLayer('cc-route-ib')) {
      map.removeLayer('cc-route-ib');
    }
    if (map.getLayer('cc-route-ob')) {
      map.removeLayer('cc-route-ob');
    }
    if (map.getSource('cc-route')) {
      map.removeSource('cc-route');
    }

    map.addSource('cc-route', {
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
        id: 'cc-route-ib',
        type: 'line',
        source: 'cc-route',
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
        id: 'cc-route-ob',
        type: 'line',
        source: 'cc-route',
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

  function normalizeHeading(heading) {
    if (!Number.isFinite(heading)) {
      return 0;
    }
    const normalized = heading % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  function angleDifference(a, b) {
    const diff = Math.abs(normalizeHeading(a) - normalizeHeading(b));
    return Math.min(diff, 360 - diff);
  }

  function getVehiclePose(vehicle) {
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

  function addBusLayerIfNeeded() {
    if (!isMapLoaded) {
      return;
    }

    if (!busLayer) {
      busLayer = createBusLayer();
    }

    if (map.getLayer('bus-3d-layer')) {
      map.removeLayer('bus-3d-layer');
    }

    map.addLayer(busLayer);
  }

  function createBusLayer() {
    return {
      id: 'bus-3d-layer',
      type: 'custom',
      renderingMode: '3d',
      onAdd(layerMap, gl) {
        busScene = new THREE.Scene();
        busCamera = new THREE.Camera();
        busScene.add(new THREE.AmbientLight(0xffffff, 1));

        const loader = new GLTFLoader();
        loader.load(BUS_MODEL_URL, (gltf) => {
          busModelTemplate = gltf.scene;
          busModelReady = true;
        });

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

          const mapMatrix = new THREE.Matrix4().fromArray(matrix);
          busCamera.projectionMatrix = mapMatrix.multiply(modelMatrix);
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

  function findArrivals(vehicles) {
    const arrivals = [];

    vehicles.forEach((vehicle) => {
      const predictions = Array.isArray(vehicle.predictions) ? vehicle.predictions : [];

      predictions.forEach((prediction) => {
        if (prediction.stopId !== MOUNT_HALL_STOP_ID) {
          return;
        }

        const seconds = Number(prediction.timeToArrivalInSeconds);
        if (!Number.isFinite(seconds)) {
          return;
        }
        const distanceFeet = Number(prediction.vehicleDistanceInFeet);

        arrivals.push({
          seconds,
          distanceFeet: Number.isFinite(distanceFeet) ? distanceFeet : null,
          vehicleId: vehicle.id ?? 'n/a',
          isDelayed: prediction.isDelayed ?? false,
          predictionTime: prediction.predictionTime ?? null
        });
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

  function getActionMessage(arrival) {
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

  function findVehicleById(vehicles, vehicleId) {
    return vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
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

  function renderStatus(vehicles, arrivals) {
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
        <span class="hud-time-value">${minutes !== null ? minutes : '--'}</span>
        <span class="hud-time-unit">min</span>
      </div>
      <div class="hud-sep"></div>
      <div class="hud-info">
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
      renderMountHallStop(routeData.stops);
      renderStopLabels(routeData.stops);
      renderRouteLines(routeData.patterns);

      const arrivals = findArrivals(vehicles);
      const nextArrival = arrivals[0] ?? null;
      const nextVehicle = nextArrival ? findVehicleById(vehicles, nextArrival.vehicleId) : null;

      if (nextVehicle) {
        const pose = getVehiclePose(nextVehicle);
        const followCenter = pose.position;
        const followHeading = Number.isFinite(pose.heading)
          ? normalizeHeading(pose.heading)
          : map.getBearing();

        if (!hasFitBounds) {
          map.jumpTo({
            center: followCenter,
            zoom: FOLLOW_ZOOM,
            pitch: FOLLOW_PITCH,
            bearing: followHeading,
            offset: FOLLOW_OFFSET
          });
          hasFitBounds = true;
        } else {
          map.easeTo({
            center: followCenter,
            zoom: FOLLOW_ZOOM,
            pitch: FOLLOW_PITCH,
            bearing: followHeading,
            offset: FOLLOW_OFFSET,
            duration: 900,
            easing: (t) => t * (2 - t)
          });
        }
      }

      renderVehicles(vehicles, nextVehicle?.id ?? null);
      renderStatus(vehicles, arrivals);
    } catch (error) {
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

  return {
    supportsDocumentPictureInPicture,
    togglePictureInPictureWindow,
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
