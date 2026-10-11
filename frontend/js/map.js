

const BERLIN_CENTER = [52.5125, 13.3269]; // SimRa's home city; a sane default before any data loads

let heatmapMap = null;
let heatmapLayer = null;

let routeMap = null;
let routeLayer = null;

let networkMap = null;
let networkLayer = null;

let variableMap = null;
let variableMapLayer = null;

function tileLayer() {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  });
}



const STUDY_CORRIDOR = {
  pointA: {
    name: "Ernst-Reuter-Platz",
    area: "Charlottenburg",
    lat: 52.51264,
    lon: 13.32189,
  },
  pointB: {
    name: "Oberbaumbrücke",
    area: "Friedrichshain-Kreuzberg",
    lat: 52.50120,
    lon: 13.44500,
  },
};

let studyCorridorMaps = {};
let studyCorridorLayers = {};
let studyCorridorRoutePromise = null;
let studyCorridorRoute = null;

function corridorMarker(point, label) {
  const cls = label === "A" ? "corridor-marker-a" : "corridor-marker-b";
  const icon = L.divIcon({
    className: "corridor-marker-wrap",
    html: `<div class="corridor-map-marker ${cls}">${label}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
  return L.marker([point.lat, point.lon], {
    title: `${label} · ${point.name}`,
    icon,
  }).bindTooltip(`<strong>${label}</strong> · ${point.name}<br>${point.area}, Berlin`, {
    direction: "top",
    permanent: false,
    sticky: true,
    className: "corridor-label",
  });
}

function addCorridorMarkers(layer) {
  corridorMarker(STUDY_CORRIDOR.pointA, "A").addTo(layer);
  corridorMarker(STUDY_CORRIDOR.pointB, "B").addTo(layer);
}

async function fetchStudyCorridorRoute() {
  if (studyCorridorRoutePromise) return studyCorridorRoutePromise;

  studyCorridorRoutePromise = (async () => {
    // 1. Prefer the canonical bundled bicycle route shared with SUMO runner
    if (window.BUNDLED_CORRIDOR_ROUTE && window.BUNDLED_CORRIDOR_ROUTE.latlngs?.length) {
      return {
        latlngs: window.BUNDLED_CORRIDOR_ROUTE.latlngs,
        distanceM: window.BUNDLED_CORRIDOR_ROUTE.distanceM,
        source: "OpenStreetMap bicycle corridor (canonical)",
        approximate: false,
      };
    }

    // 2. Fallback to bike routing endpoint if bundled route is unavailable
    const a = STUDY_CORRIDOR.pointA;
    const b = STUDY_CORRIDOR.pointB;
    const waypoints = [a, b].map((point) => `${point.lon},${point.lat}`).join(";");
    const endpoints = [
      `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${waypoints}?overview=full&geometries=geojson&steps=false`,
      `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson&steps=false`,
    ];

    for (const url of endpoints) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`router ${response.status}`);
        const data = await response.json();
        const route = data.routes && data.routes[0];
        if (!route?.geometry?.coordinates?.length) throw new Error("no geometry");
        return {
          latlngs: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
          distanceM: route.distance,
          source: "OpenStreetMap bicycle route",
          approximate: false,
        };
      } catch (_) {
        // Try the next public OSM routing endpoint.
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      latlngs: [],
      distanceM: 0,
      source: "unavailable",
      approximate: true,
    };
  })();
  studyCorridorRoute = await studyCorridorRoutePromise;
  return studyCorridorRoute;
}

function drawStudyCorridor(map, route, elementId) {
  if (studyCorridorLayers[elementId]) map.removeLayer(studyCorridorLayers[elementId]);
  const layer = L.layerGroup();
  const path = route.latlngs;

  if (path.length) {
    L.polyline(path, {
      color: "#ffffff", weight: 10, opacity: 0.78, lineCap: "round", lineJoin: "round",
    }).addTo(layer);
    L.polyline(path, {
      color: themeColor("--teal"), weight: 5, opacity: 0.98, lineCap: "round", lineJoin: "round",
    }).bindTooltip("Fixed study corridor · A → B", { sticky: true }).addTo(layer);
    map.fitBounds(path, { padding: [34, 34], maxZoom: 13 });
  } else {
    map.fitBounds([
      [STUDY_CORRIDOR.pointA.lat, STUDY_CORRIDOR.pointA.lon],
      [STUDY_CORRIDOR.pointB.lat, STUDY_CORRIDOR.pointB.lon],
    ], { padding: [34, 34], maxZoom: 13 });
  }

  addCorridorMarkers(layer);
  layer.addTo(map);
  studyCorridorLayers[elementId] = layer;

  const km = route.distanceM > 0 ? route.distanceM / 1000 : null;
  const status = route.approximate
    ? "Road router unavailable — no artificial straight-line path is shown."
    : `Real road route loaded · ${km.toFixed(2)} km · OpenStreetMap road routing`;
  const statusEl = document.getElementById(elementId === "study-corridor-map" ? "study-corridor-status" : "study-corridor-status-page");
  if (statusEl) statusEl.textContent = status;
  setTimeout(() => map.invalidateSize(), 50);
}

async function renderStudyCorridor(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!studyCorridorMaps[elementId]) {
    studyCorridorMaps[elementId] = L.map(elementId, { scrollWheelZoom: false, zoomControl: true });
    tileLayer().addTo(studyCorridorMaps[elementId]);
  }
  const map = studyCorridorMaps[elementId];
  const statusId = elementId === "study-corridor-map" ? "study-corridor-status" : "study-corridor-status-page";
  const status = document.getElementById(statusId);
  if (status) status.textContent = "Routing the fixed A → B corridor along real roads…";
  const route = await fetchStudyCorridorRoute();
  drawStudyCorridor(map, route, elementId);
}

function renderVariableCorridorMap(elementId, buckets) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!variableMap) {
    variableMap = L.map(elementId, { scrollWheelZoom: false, zoomControl: true });
    tileLayer().addTo(variableMap);
  }
  if (variableMapLayer) variableMap.removeLayer(variableMapLayer);
  variableMapLayer = L.layerGroup();

  const path = studyCorridorRoute?.latlngs || window.BUNDLED_CORRIDOR_ROUTE?.latlngs || [];
  if (path.length) {
    L.polyline(path, {
      color: "#ffffff", weight: 9, opacity: 0.70, lineCap: "round", lineJoin: "round",
    }).addTo(variableMapLayer);
    L.polyline(path, {
      color: themeColor("--teal"), weight: 4, opacity: 0.80, lineCap: "round", lineJoin: "round",
    }).addTo(variableMapLayer);
  }
  addCorridorMarkers(variableMapLayer);

  if (buckets.length) {
    const maxCount = Math.max(...buckets.map((b) => b.count));
    buckets.forEach((b) => {
      const weight = b.count / maxCount;
      const severity = dominantSeverity(b);
      const color = severityColor(severity);
      const breakdown = [
        b.high_count ? `${b.high_count} high` : null,
        b.medium_count ? `${b.medium_count} medium` : null,
        b.low_count ? `${b.low_count} low` : null,
      ].filter(Boolean).join(" · ");
      L.circleMarker([b.lat, b.lon], {
        radius: 7 + weight * 18,
        color, weight: 2, fillColor: color, fillOpacity: 0.28 + weight * 0.45,
      }).bindTooltip(`${b.count} incident${b.count === 1 ? "" : "s"} · ${breakdown}`).addTo(variableMapLayer);
    });
  }

  variableMapLayer.addTo(variableMap);
  if (path.length) variableMap.fitBounds(path, { padding: [34, 34], maxZoom: 13 });
  else variableMap.fitBounds([
    [STUDY_CORRIDOR.pointA.lat, STUDY_CORRIDOR.pointA.lon],
    [STUDY_CORRIDOR.pointB.lat, STUDY_CORRIDOR.pointB.lon],
  ], { padding: [34, 34], maxZoom: 13 });

  const status = document.getElementById("variable-map-status");
  if (status) {
    status.textContent = buckets.length
      ? `${buckets.reduce((sum, b) => sum + b.count, 0)} incident samples across ${buckets.length} mapped area${buckets.length === 1 ? "" : "s"}. Updated from current ride data.`
      : "No rides or incidents logged yet · the corridor remains clear until simulation data arrive.";
  }
  setTimeout(() => variableMap.invalidateSize(), 50);
}

function severityColor(severity) {
  if (severity === "high") return themeColor("--danger");
  if (severity === "medium") return themeColor("--amber");
  return themeColor("--text-faint");
}
function dominantSeverity(b) {
  if (b.high_count >= b.medium_count && b.high_count >= b.low_count && b.high_count > 0) return "high";
  if (b.medium_count >= b.low_count && b.medium_count > 0) return "medium";
  if (b.low_count > 0) return "low";
  return "medium"; // shouldn't happen (a bucket only exists because it has incidents), but a safe fallback
}

function renderHeatmap(elementId, buckets) {
  if (!heatmapMap) {
    heatmapMap = L.map(elementId, { scrollWheelZoom: false }).setView(BERLIN_CENTER, 13);
    tileLayer().addTo(heatmapMap);
  }
  if (heatmapLayer) heatmapMap.removeLayer(heatmapLayer);

  heatmapLayer = L.layerGroup();
  if (buckets.length === 0) {
    heatmapLayer.addTo(heatmapMap);
    heatmapMap.setView(BERLIN_CENTER, 13);
    return;
  }

  const maxCount = Math.max(...buckets.map((b) => b.count));
  const bounds = [];
  buckets.forEach((b) => {
    const weight = b.count / maxCount; // 0..1
    const radius = 7 + weight * 20;
    const color = severityColor(dominantSeverity(b));
    const breakdown = [
      b.high_count ? `${b.high_count} high` : null,
      b.medium_count ? `${b.medium_count} medium` : null,
      b.low_count ? `${b.low_count} low` : null,
    ].filter(Boolean).join(" · ");
    L.circleMarker([b.lat, b.lon], {
      radius,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.3 + weight * 0.45,
    })
      .bindTooltip(`${b.count} incident${b.count === 1 ? "" : "s"} near here — ${breakdown}`)
      .addTo(heatmapLayer);
    bounds.push([b.lat, b.lon]);
  });
  heatmapLayer.addTo(heatmapMap);
  heatmapMap.fitBounds(bounds, { maxZoom: 14, padding: [24, 24] });

  // The container was hidden (display:none) the first time this map might
  // have been created, so Leaflet may have measured a zero-size box.
  setTimeout(() => heatmapMap.invalidateSize(), 50);
}

function formatBikeLabel(bikeId) {
  if (!bikeId || bikeId === "ego_bicycle" || bikeId === "bicycle") return "Bicycle 1 (ego_bicycle)";
  const m = String(bikeId).match(/bike_0*(\d+)/i);
  if (m) {
    const num = parseInt(m[1], 10) + 1;
    return `Bicycle ${num} (${bikeId})`;
  }
  return `Bicycle (${bikeId})`;
}

/** renderRoute draws (or redraws) one ride's GPS trace, Point A/B markers, and conflict locations. */
function renderRoute(elementId, points, incidents, counterpartId = null, selectedInfo = null, primaryBikeId = null) {
  if (!routeMap) {
    routeMap = L.map(elementId, { scrollWheelZoom: false }).setView(BERLIN_CENTER, 14);
    tileLayer().addTo(routeMap);
  }
  if (routeLayer) routeMap.removeLayer(routeLayer);
  routeLayer = L.layerGroup();

  // 1. Draw corridor route polyline
  if (points && points.length > 0) {
    const latlngs = points.map((p) => [p.lat, p.lon]);
    L.polyline(latlngs, {
      color: themeColor("--teal") || "#14b8a6",
      weight: 4,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round",
    }).bindTooltip("Study corridor route (A → B)", { sticky: true }).addTo(routeLayer);
  }

  // 2. Add Point A (Ernst-Reuter-Platz) and Point B (Oberbaumbrücke) corridor markers
  addCorridorMarkers(routeLayer);

  // 3. Spatially cluster incidents within ~25 meters for precise inspection and hotspot display
  let incList = incidents || [];
  if (counterpartId) {
    incList = incList.filter((i) => i.counterpart_id === counterpartId);
  }
  if (primaryBikeId) {
    incList = incList.filter((i) => !i.primary_bike_id || i.primary_bike_id === primaryBikeId);
  }

  // If pair has no flagged incidents but has a recorded closest approach GPS point, display it
  if (counterpartId && incList.length === 0 && selectedInfo && selectedInfo.lat && selectedInfo.lon) {
    const isClose = selectedInfo.min_distance_m != null && selectedInfo.min_distance_m < 1.5;
    const color = isClose ? (themeColor("--amber") || "#f59e0b") : (themeColor("--teal") || "#14b8a6");
    L.circleMarker([selectedInfo.lat, selectedInfo.lon], {
      radius: 9,
      color: "#ffffff",
      weight: 2.5,
      fillColor: color,
      fillOpacity: 0.85,
    }).bindTooltip(`<strong>${counterpartId}</strong> · Closest clearance: ${selectedInfo.min_distance_m != null ? selectedInfo.min_distance_m.toFixed(2) + ' m' : 'recorded approach'}`).addTo(routeLayer);
  }
  const clusters = [];
  const visited = new Set();

  incList.forEach((inc, idx) => {
    if (visited.has(idx)) return;
    const cluster = [inc];
    visited.add(idx);

    incList.forEach((otherInc, otherIdx) => {
      if (idx !== otherIdx && !visited.has(otherIdx)) {
        const dLat = (inc.lat - otherInc.lat) * 111320;
        const dLon = (inc.lon - otherInc.lon) * 111320 * Math.cos((inc.lat * Math.PI) / 180);
        const distM = Math.sqrt(dLat * dLat + dLon * dLon);
        if (distM <= 25.0) {
          cluster.push(otherInc);
          visited.add(otherIdx);
        }
      }
    });
    clusters.push(cluster);
  });

  clusters.forEach((cluster) => {
    const primaryInc = cluster[0];
    const isSelected = counterpartId && cluster.some((c) => c.counterpart_id === counterpartId);
    const isOther = counterpartId && !isSelected;
    const hasSevere = cluster.some((c) => c.severity === "high");

    const baseColor = hasSevere ? (themeColor("--danger") || "#ef4444") : (themeColor("--amber") || "#f59e0b");
    const radius = isSelected ? 12 : (hasSevere ? (cluster.length > 1 ? 10 : 8) : (cluster.length > 1 ? 9 : 7));
    const weight = isSelected ? 3 : (cluster.length > 1 ? 2.5 : 1.5);
    const opacity = isOther ? 0.35 : (hasSevere ? 0.9 : 0.8);

    const marker = L.circleMarker([primaryInc.lat, primaryInc.lon], {
      radius,
      color: isSelected ? "#ffffff" : baseColor,
      weight,
      fillColor: baseColor,
      fillOpacity: opacity,
    });

    const activeBikeLabel = formatBikeLabel(primaryBikeId || primaryInc.primary_bike_id || "ego_bicycle");

    let tooltipHtml = "";
    if (cluster.length === 1) {
      const inc = primaryInc;
      const isSevere = inc.severity === "high";
      const sevLabel = isSevere ? "🚨 Severe Conflict" : "⚠️ Close Pass / Incident";
      const cpText = inc.counterpart_id
        ? `${(inc.counterpart_agent_type || 'Vehicle').toUpperCase()} (${inc.counterpart_id})`
        : "Traffic entity";
      const bikeText = inc.primary_bike_id ? formatBikeLabel(inc.primary_bike_id) : activeBikeLabel;
      const evidenceRow = inc.evidence ? `<div style="margin-top:4px; font-size:11px; opacity:0.9;"><strong>Evidence:</strong> ${inc.evidence}</div>` : "";

      tooltipHtml = `
        <div style="font-size:12px; line-height:1.45; min-width:210px;">
          <div style="font-weight:700; color:${isSevere ? '#ef4444' : '#f59e0b'}; margin-bottom:4px;">${sevLabel}</div>
          <div><strong>🚲 Primary Bicycle:</strong> ${bikeText}</div>
          <div><strong>🚗 Counterpart:</strong> ${cpText}</div>
          <div><strong>📐 Clearance:</strong> ${inc.magnitude.toFixed(2)} m (${inc.incident_type.replace(/_/g, " ")})</div>
          <div><strong>📍 GPS Location:</strong> ${inc.lat.toFixed(6)}° N, ${inc.lon.toFixed(6)}° E</div>
          <div><strong>⏱️ Time:</strong> ${new Date(inc.detected_at).toLocaleTimeString()}</div>
          ${evidenceRow}
        </div>
      `;
    } else {
      // Multiple conflicts at this hotspot
      const entries = cluster.map((inc, i) => {
        const isSev = inc.severity === "high";
        const cpText = inc.counterpart_id
          ? `${(inc.counterpart_agent_type || 'Vehicle')} (${inc.counterpart_id})`
          : "Vehicle";
        const bText = inc.primary_bike_id ? formatBikeLabel(inc.primary_bike_id) : activeBikeLabel;
        return `
          <div style="margin-top:4px; padding:4px 6px; border-left:2px solid ${isSev ? '#ef4444' : '#f59e0b'}; background:rgba(255,255,255,0.04);">
            <strong>#${i + 1} ${isSev ? '🚨 Severe' : '⚠️ Close pass'}:</strong> ${inc.magnitude.toFixed(2)} m<br>
            <span>🚲 Primary: ${bText}</span><br>
            <span>🚗 Counterpart: ${cpText}</span>
          </div>
        `;
      }).join("");

      tooltipHtml = `
        <div style="font-size:12px; line-height:1.45; min-width:230px;">
          <div style="font-weight:700; margin-bottom:4px;">📍 Conflict Hotspot (${cluster.length} incidents recorded)</div>
          ${entries}
          <div style="margin-top:6px; font-size:11px; opacity:0.85;">
            <strong>📍 GPS Location:</strong> ${primaryInc.lat.toFixed(6)}° N, ${primaryInc.lon.toFixed(6)}° E
          </div>
        </div>
      `;
    }

    marker.bindTooltip(tooltipHtml, { sticky: true, className: "corridor-label" });
    marker.addTo(routeLayer);
  });

  // 4. If a counterpart vehicle is selected that has NO flagged incident (e.g. a Safe Pass),
  // plot its encounter location so the user sees where the interaction took place on the corridor!
  if (counterpartId && selectedInfo && selectedInfo.lat && selectedInfo.lon) {
    const hasPairIncident = (incidents || []).some((inc) => inc.counterpart_id === counterpartId);
    if (!hasPairIncident) {
      const isSafe = selectedInfo.status && selectedInfo.status.toLowerCase().includes("safe");
      const encColor = isSafe ? (themeColor("--teal") || "#14b8a6") : "#38bdf8";
      const encMarker = L.circleMarker([selectedInfo.lat, selectedInfo.lon], {
        radius: 11,
        color: "#ffffff",
        weight: 3,
        fillColor: encColor,
        fillOpacity: 0.9,
      });
      encMarker.bindTooltip(`
        <strong>✓ Safe Encounter Location</strong><br>
        <strong>Counterpart:</strong> ${counterpartId}<br>
        <strong>Status:</strong> ${selectedInfo.status}<br>
        <strong>Closest clearance:</strong> ${selectedInfo.min_distance_m >= 900 ? 'No close approach' : selectedInfo.min_distance_m.toFixed(2) + ' m'}
      `, { sticky: true, className: "corridor-label" });
      encMarker.addTo(routeLayer);
    }
  }

  routeLayer.addTo(routeMap);

  // 5. Fit bounds to include Point A, Point B, and points
  const bounds = [
    [STUDY_CORRIDOR.pointA.lat, STUDY_CORRIDOR.pointA.lon],
    [STUDY_CORRIDOR.pointB.lat, STUDY_CORRIDOR.pointB.lon],
  ];
  if (points && points.length > 0) {
    points.forEach((p) => bounds.push([p.lat, p.lon]));
  }
  routeMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
  setTimeout(() => routeMap.invalidateSize(), 50);
}

/** renderNetworkConfig draws the configured directed edges and nodes. */
function renderNetworkConfig(elementId, config) {
  if (!networkMap) {
    networkMap = L.map(elementId, { scrollWheelZoom: false }).setView(BERLIN_CENTER, 13);
    tileLayer().addTo(networkMap);
  }
  if (networkLayer) networkMap.removeLayer(networkLayer);
  networkLayer = L.layerGroup();

  const nodes = new Map((config.nodes || []).map((node) => [node.id, node]));
  const bounds = [];
  (config.edges || []).forEach((edge) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) return;
    const isBicycleOnly = (edge.lanes || []).some((lane) => lane.type === "bicycle-only");
    L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
      color: isBicycleOnly ? themeColor("--teal") : themeColor("--amber"),
      weight: isBicycleOnly ? 6 : 4,
      opacity: 0.8,
    }).bindTooltip(`${edge.id} · ${isBicycleOnly ? "bicycle-only + mixed" : "mixed"}`).addTo(networkLayer);
    bounds.push([from.lat, from.lon], [to.lat, to.lon]);
  });
  (config.nodes || []).forEach((node) => {
    L.circleMarker([node.lat, node.lon], {
      radius: 5,
      color: themeColor("--text"),
      fillColor: themeColor("--text"),
      fillOpacity: 1,
    }).bindTooltip(node.id).addTo(networkLayer);
  });
  networkLayer.addTo(networkMap);
  if (bounds.length > 0) networkMap.fitBounds(bounds, { padding: [24, 24] });
  setTimeout(() => networkMap.invalidateSize(), 50);
}
