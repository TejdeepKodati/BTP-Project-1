document.addEventListener("DOMContentLoaded", () => {
  const views = document.querySelectorAll(".view");
  const navItems = document.querySelectorAll(".nav-item");

  function showView(name) {
    views.forEach((v) => {
      const active = v.id === `view-${name}`;
      v.classList.toggle("is-active", active);
      v.hidden = !active;
    });
    navItems.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.view === name));
  }

  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.view);
      if (btn.dataset.view === "overview") loadOverview();
      if (btn.dataset.view === "rides") loadAllRides();
      if (btn.dataset.view === "network") loadNetwork();
    });
  });

  document.getElementById("back-to-rides").addEventListener("click", () => {
    showView("rides");
    loadAllRides();
  });

  const simulateBtn = document.getElementById("simulate-btn");
  const netSimulateBtn = document.getElementById("network-simulate-btn");
  const simProgressWrap = document.getElementById("sim-progress-wrap");
  const simProgressBar = document.getElementById("sim-progress-bar");
  const simProgressDetail = document.getElementById("sim-progress-detail");
  if (simulateBtn) simulateBtn.addEventListener("click", onSimulateClick);
  if (netSimulateBtn) netSimulateBtn.addEventListener("click", onSimulateClick);

  const resetBtn = document.getElementById("reset-dashboard-btn");
  if (resetBtn) resetBtn.addEventListener("click", onResetDashboard);

  document.addEventListener("cyclesafe:theme-changed", () => {
    // Redraw charts with current points & encounter samples on theme change
    if (window.__lastPoints) {
      renderAccelChart(document.getElementById("accel-chart"), window.__lastPoints, window.__selectedEncounterSamples);
      renderGyroChart(document.getElementById("gyro-chart"), window.__lastPoints);
      renderProximityChart(document.getElementById("proximity-chart"), window.__lastPoints, window.__selectedEncounterSamples);
    }
  });

  document.querySelectorAll("[data-reset-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => resetChartZoom(btn.dataset.resetZoom));
  });

  // -------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------

  function formatKm(meters) {
    return (meters / 1000).toFixed(2);
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function rideTitle(ride) {
    const conflict = ride.metadata && ride.metadata.conflict_target ? ` · ${prettyConflict(ride.metadata.conflict_target)}` : "";
    return `Ride · ${formatDate(ride.started_at)}${conflict}`;
  }

  function emptyRidesState() {
    const el = document.createElement("div");
    el.className = "empty-state";
    el.innerHTML = `<strong>No rides yet</strong>No hardware to plug in yet, so start with a SUMO simulation — it runs simulation-derived SimRa-shaped telemetry through the same ingest and detection pipeline a device upload will use.`;
    return el;
  }

  function renderRideRow(ride) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ride-row";
    const incidentTagClass = ride.incident_count > 0 ? "tag tag-incidents" : "tag tag-incidents is-zero";
    const seedMeta = ride.metadata && ride.metadata.seed != null ? ` · Seed: ${ride.metadata.seed}` : "";
    row.innerHTML = `
      <div class="ride-row-main">
        <span class="ride-row-title">${rideTitle(ride)}</span>
        <span class="ride-row-meta">${formatKm(ride.distance_m)} km · ${ride.point_count} samples${seedMeta}</span>
      </div>
      <div class="ride-row-tags">
        <span class="tag tag-source">${ride.source}</span>
        <span class="${incidentTagClass}">${ride.incident_count} incident${ride.incident_count === 1 ? "" : "s"}</span>
      </div>`;
    row.addEventListener("click", () => showRideDetail(ride.id));
    return row;
  }

  function renderRideList(container, rides) {
    container.innerHTML = "";
    if (rides.length === 0) {
      container.appendChild(emptyRidesState());
      return;
    }
    rides.forEach((ride) => container.appendChild(renderRideRow(ride)));
  }

  // -------------------------------------------------------------------
  // Overview (100% PRESERVED)
  // -------------------------------------------------------------------

  async function loadOverview() {
    try {
      const [stats, heatmap, rides] = await Promise.all([api.getOverview(), api.getHeatmap(), api.listRides()]);

      document.getElementById("stat-rides").textContent = stats.total_rides;
      document.getElementById("stat-distance").textContent = stats.total_distance_km.toFixed(1);
      document.getElementById("stat-incidents").textContent = stats.total_incidents;
      document.getElementById("stat-high").textContent = stats.high_severity_count;
      document.getElementById("stat-score").textContent = Math.round(stats.safety_score);

      await renderStudyCorridor("study-corridor-map");
      renderVariableCorridorMap("variable-map", heatmap);
      renderRideList(document.getElementById("recent-rides-list"), rides.slice(0, 6));
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // -------------------------------------------------------------------
  // All rides
  // -------------------------------------------------------------------

  async function loadAllRides() {
    try {
      const rides = await api.listRides();
      renderRideList(document.getElementById("all-rides-list"), rides);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // -------------------------------------------------------------------
  // Study corridor & Road network
  // -------------------------------------------------------------------

  function loadNetwork() {
    renderStudyCorridor("study-corridor-map-page").catch((err) => showToast(`Corridor map: ${err.message}`, true));
    updateNetworkRunSummary();
  }

  function prettyConflict(value) {
    const labels = {
      "bicycle-bicycle": "Bicycle ↔ Bicycle",
      "bicycle-car": "Bicycle ↔ Car",
      "bicycle-motorbike": "Bicycle ↔ Motorbike",
      "bicycle-heavy-duty": "Bicycle ↔ Heavy-duty",
    };
    return labels[value] || value;
  }

  function updateNetworkRunSummary() {
    const summary = document.getElementById("network-run-summary");
    if (!summary) return;
    summary.textContent = `${prettyConflict(window.__selectedConflict)} · Fixed 60-minute duration · Reference Oberbaumbrücke baseline demand · fresh recorded seed on every run.`;
  }

  // -------------------------------------------------------------------
  // Ride detail
  // -------------------------------------------------------------------

  async function showRideDetail(id) {
    showView("ride-detail");
    document.getElementById("ride-detail-title").textContent = "Loading ride…";
    document.getElementById("ride-detail-sub").textContent = "";

    try {
      const [ride, points, incidents, interactions] = await Promise.all([
        api.getRide(id),
        api.getRidePoints(id),
        api.getRideIncidents(id),
        api.getRideInteractions(id),
      ]);

      document.getElementById("ride-detail-title").textContent = rideTitle(ride);
      const seedText = ride.metadata && ride.metadata.seed != null ? ` · Seed: ${ride.metadata.seed}` : "";
      document.getElementById("ride-detail-sub").textContent =
        `${formatKm(ride.distance_m)} km · ${points.length} samples · ${incidents.length} incident${incidents.length === 1 ? "" : "s"} flagged · source: ${ride.source}${seedText}`;

      window.__lastPoints = points;
      window.__lastIncidents = incidents;
      window.__lastInteractions = interactions;
      window.__selectedEncounterSamples = null;

      const isPrototype = ride.source === "sumo" || (ride.metadata && ride.metadata.network_type === "controlled_prototype_network");
      const mapTitle = document.getElementById("ride-map-panel-title");
      const mapSub = document.getElementById("ride-map-panel-sub");
      const mapBadge = document.getElementById("ride-map-panel-badge");
      const legA = document.getElementById("legend-item-a");
      const legB = document.getElementById("legend-item-b");

      if (isPrototype) {
        if (mapTitle) mapTitle.textContent = "Controlled 2.0 km Prototype Track & Conflict Locations";
        if (mapSub) mapSub.textContent = "Controlled 2.0 km linear calibration track · Prototype simulation, not real Berlin street locations.";
        if (mapBadge) { mapBadge.textContent = "2.0 km PROTOTYPE TRACK"; mapBadge.className = "corridor-badge corridor-badge-variable"; }
        if (legA) legA.innerHTML = '<span class="legend-dot is-point-a"></span><strong>Node W:</strong> West Anchor (0 m)';
        if (legB) legB.innerHTML = '<span class="legend-dot is-point-b"></span><strong>Node E:</strong> East Anchor (2,000 m)';
      } else {
        if (mapTitle) mapTitle.textContent = "Ride corridor & conflict locations";
        if (mapSub) mapSub.textContent = "Study corridor between Point A and Point B with detected traffic conflicts on this ride.";
        if (mapBadge) { mapBadge.textContent = "A → B CORRIDOR"; mapBadge.className = "corridor-badge"; }
        if (legA) legA.innerHTML = '<span class="legend-dot is-point-a"></span><strong>Point A:</strong> Ernst-Reuter-Platz (Start)';
        if (legB) legB.innerHTML = '<span class="legend-dot is-point-b"></span><strong>Point B:</strong> Oberbaumbrücke (End)';
      }

      renderRoute("route-map", points, incidents, null, null, null, ride);
      renderRideConflictSummary(incidents, interactions);
      renderInteractionControls(points, incidents, interactions, ride);
      renderGyroChart(document.getElementById("gyro-chart"), points);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderRideConflictSummary(incidents, interactions) {
    const el = document.getElementById("ride-conflict-summary");
    const area = document.getElementById("ride-conflict-area-text");
    if (!el || !area) return;
    const high = incidents.filter((i) => i.severity === "high").length;
    const medium = incidents.filter((i) => i.severity === "medium").length;
    const categories = [...new Set(incidents.map((i) => i.conflict_category).filter(Boolean))].map(humanize);
    const areas = incidents.map((i) => `${i.lat.toFixed(4)}, ${i.lon.toFixed(4)}`);
    const conflictStatus = incidents.length === 0
      ? "No conflicts detected"
      : high > 0
      ? `${high} critical conflict${high === 1 ? "" : "s"}`
      : `${medium} close pass${medium === 1 ? "" : "es"}`;

    el.innerHTML = `
      <div class="interaction-card"><span>Evaluated counterpart pairs</span><strong>${interactions.length}</strong></div>
      <div class="interaction-card"><span>Total flagged conflicts</span><strong>${incidents.length}</strong></div>
      <div class="interaction-card"><span>Critical / Close pass</span><strong>${high} / ${medium}</strong></div>
      <div class="interaction-card"><span>Conflict status</span><strong>${conflictStatus}</strong></div>
      <div class="interaction-card"><span>Conflict types</span><strong>${categories.length ? categories.join(", ") : "None"}</strong></div>`;
    area.textContent = areas.length
      ? `Conflict locations recorded on this ride: ${[...new Set(areas)].slice(0, 8).join(" · ")}${areas.length > 8 ? " · …" : ""}. Selecting a counterpart below filters the map and charts to that pair.`
      : "No flagged conflict areas were recorded on this ride.";
  }

  function humanize(value) {
    return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function prettyAgentType(type) {
    const labels = { bike: "Bicycle", bicycle: "Bicycle", car: "Car", moto: "Motorbike", motorbike: "Motorbike", truck: "Heavy-duty", bus: "Heavy-duty", "heavy-duty": "Heavy-duty" };
    return labels[type] || humanize(type || "Vehicle");
  }

  function agentTypeMatchesFamily(item, family) {
    if (!family || family === "all") return true;
    const t = String((item && (item.counterpart_agent_type || item.type)) || (typeof item === "string" ? item : "")).toLowerCase();
    const id = String((item && (item.counterpart_id || item.id)) || "").toLowerCase();
    if (family === "bicycle-bicycle") return t.includes("bike") || id.startsWith("bike");
    if (family === "bicycle-car") return t.includes("car") || id.startsWith("car");
    if (family === "bicycle-motorbike") return t.includes("moto") || id.startsWith("moto");
    if (family === "bicycle-heavy-duty") return t.includes("truck") || t.includes("bus") || t.includes("heavy") || id.startsWith("truck") || id.startsWith("bus");
    return true;
  }

  function formatBikeId(bikeId) {
    if (!bikeId || bikeId === "ego_bicycle" || bikeId === "bicycle") return "Bicycle 1 · ego_bicycle (instrumented bike)";
    const m = String(bikeId).match(/bike_0*(\d+)/i);
    if (m) {
      const num = parseInt(m[1], 10) + 1;
      return `Bicycle ${num} · ${bikeId}`;
    }
    return `Bicycle · ${bikeId}`;
  }

  function renderInteractionControls(points, incidents, interactions, ride) {
    const bikeSelect = document.getElementById("interaction-bike-select");
    const vehicleSelect = document.getElementById("interaction-vehicle-select");
    const panel = document.getElementById("interaction-result");
    const chipsContainer = document.getElementById("pair-filter-chips");
    if (!bikeSelect || !vehicleSelect || !panel) return;

    const bikeEncounters = (ride && ride.metadata && ride.metadata.bike_encounters) || {};
    const metaBikes = (ride && ride.metadata && ride.metadata.primary_bicycles) || [];

    // 1. Compile all known simulated bicycles for the primary dropdown
    const knownBikes = new Map();
    knownBikes.set("ego_bicycle", "Bicycle 1 · ego_bicycle (instrumented bike)");

    if (Array.isArray(metaBikes)) {
      metaBikes.forEach((b, idx) => {
        if (b && b.id) knownBikes.set(b.id, b.label || formatBikeId(b.id));
      });
    }

    Object.keys(bikeEncounters).forEach((bid) => {
      if (!knownBikes.has(bid)) knownBikes.set(bid, formatBikeId(bid));
    });

    interactions.forEach((item) => {
      const id = item.counterpart_id || "";
      const type = (item.counterpart_agent_type || "").toLowerCase();
      if ((type.includes("bike") || id.startsWith("bike")) && !knownBikes.has(id)) {
        knownBikes.set(id, formatBikeId(id));
      }
    });

    // Populate primary bicycle dropdown ONLY with actual recorded bicycles from the simulation
    bikeSelect.innerHTML = "";
    bikeSelect.disabled = false;
    knownBikes.forEach((label, id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label;
      bikeSelect.appendChild(opt);
    });

    // Default to the interaction family configured during the simulation run
    const defaultFamily = (ride && ride.metadata && (ride.metadata.selected_conflict || ride.metadata.conflict_target)) || window.__selectedConflict || "all";
    let activeFamily = defaultFamily;

    // Set up filter chips listeners and set active state
    if (chipsContainer) {
      chipsContainer.querySelectorAll("button").forEach((btn) => {
        const chipFamily = btn.dataset.pairFamily || "all";
        btn.classList.toggle("is-active", chipFamily === activeFamily);
        btn.onclick = () => {
          chipsContainer.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          activeFamily = btn.dataset.pairFamily || "all";
          populateVehicles();
        };
      });
    }

    function getCounterpartsForPrimary(primaryId) {
      const pEncMap = bikeEncounters[primaryId] || {};
      const map = new Map();

      // Real recorded encounters for this primary bicycle (exclude self)
      Object.keys(pEncMap).forEach((cid) => {
        if (cid === primaryId) return; // Eliminate self-pairing
        const enc = pEncMap[cid];
        map.set(cid, {
          counterpart_id: cid,
          counterpart_agent_type: enc.counterpart_type || "vehicle",
          min_distance_m: enc.min_distance_m,
          status: enc.status,
          samples: enc.samples,
          lat: enc.closest_lat,
          lon: enc.closest_lon,
          evidence: enc.evidence || "",
          ml_confidence: enc.ml_confidence,
          incident_count: (enc.status && (enc.status.includes("high") || enc.status.includes("medium"))) ? 1 : 0,
          high_count: (enc.status && enc.status.includes("high")) ? 1 : 0,
          medium_count: (enc.status && enc.status.includes("medium")) ? 1 : 0,
        });
      });

      // If primary is ego_bicycle, incorporate all real tracked interactions from ingestion
      if (primaryId === "ego_bicycle") {
        interactions.forEach((item) => {
          if (item.counterpart_id === primaryId) return; // Eliminate self-pairing
          if (!map.has(item.counterpart_id)) map.set(item.counterpart_id, item);
        });
      } else {
        // If counterpart is ego_bicycle and ego encountered this bike, reflect mutual telemetry
        const egoMutual = interactions.find((x) => x.counterpart_id === primaryId);
        if (egoMutual && !map.has("ego_bicycle")) {
          map.set("ego_bicycle", {
            counterpart_id: "ego_bicycle",
            counterpart_agent_type: "bike",
            min_distance_m: egoMutual.min_distance_m,
            status: egoMutual.status,
            samples: egoMutual.samples,
            lat: egoMutual.lat,
            lon: egoMutual.lon,
            evidence: egoMutual.evidence || "",
            ml_confidence: egoMutual.ml_confidence,
            incident_count: egoMutual.incident_count,
            high_count: egoMutual.high_count,
            medium_count: egoMutual.medium_count,
          });
        }
      }

      // DO NOT fabricate placeholder 999m or self-pairing records.
      return Array.from(map.values());
    }

    function populateVehicles() {
      const primaryId = bikeSelect.value;
      const allCandidates = getCounterpartsForPrimary(primaryId);
      const filtered = allCandidates.filter((item) => {
        if (item.counterpart_id === primaryId) return false;
        return agentTypeMatchesFamily(item, activeFamily);
      });

      // Sort: actual conflicts first (severe first), then close passes, then safe passes by distance
      filtered.sort((a, b) => {
        if (b.incident_count !== a.incident_count) return b.incident_count - a.incident_count;
        if (b.high_count !== a.high_count) return b.high_count - a.high_count;
        return a.min_distance_m - b.min_distance_m;
      });

      vehicleSelect.innerHTML = "";

      if (filtered.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        const famLabel = prettyConflict(activeFamily) !== "all" ? prettyConflict(activeFamily) : "counterpart";
        opt.textContent = `No recorded ${famLabel} encounters for this bicycle`;
        vehicleSelect.appendChild(opt);
        vehicleSelect.disabled = true;
        updatePairCard(null);
        return;
      }

      vehicleSelect.disabled = false;
      filtered.forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.counterpart_id;
        const typeLabel = prettyAgentType(item.counterpart_agent_type);
        const nameLabel = item.counterpart_id.startsWith("bike") ? (knownBikes.get(item.counterpart_id) || item.counterpart_id) : item.counterpart_id;

        if (item.incident_count > 0 || (item.status && (item.status.includes("high") || item.status.includes("medium")))) {
          opt.textContent = `⚠️ [${typeLabel}] ${nameLabel} · ${humanize(item.status)} (${item.min_distance_m.toFixed(2)} m)`;
        } else {
          opt.textContent = `✓ [${typeLabel}] ${nameLabel} · ${humanize(item.status)} (${item.min_distance_m.toFixed(2)} m)`;
        }
        vehicleSelect.appendChild(opt);
      });

      updatePairCard(filtered[0]);
    }

    function updatePairCard(selected) {
      const primaryId = bikeSelect.value;
      const primaryLabel = knownBikes.get(primaryId) || primaryId;

      if (!selected) {
        panel.innerHTML = `<div class="empty-state"><strong>No recorded encounters match the selected filter</strong>Try selecting "All vehicles" or another bicycle.</div>`;
        renderIncidentsTable([]);
        window.__selectedEncounterSamples = null;
        renderAccelChart(document.getElementById("accel-chart"), points, null);
        renderProximityChart(document.getElementById("proximity-chart"), points, null);
        renderRoute("route-map", points, [], null, null, primaryId, ride);
        return;
      }

      const counterpartId = selected.counterpart_id;
      const counterpartLabel = counterpartId.startsWith("bike") ? (knownBikes.get(counterpartId) || counterpartId) : `${prettyAgentType(selected.counterpart_agent_type)} · ${counterpartId}`;

      // Strictly pair-specific incidents
      const pairIncidents = incidents.filter((i) => i.counterpart_id === counterpartId && (!i.primary_bike_id || i.primary_bike_id === primaryId));
      renderIncidentsTable(pairIncidents);

      const hasConflict = pairIncidents.length > 0 || (selected.status && (
        selected.status.toLowerCase().includes("high") ||
        selected.status.toLowerCase().includes("medium") ||
        selected.status.toLowerCase().includes("braking") ||
        selected.status.toLowerCase().includes("close")
      ));

      const samples = selected.samples || [];
      const closestSample = samples.length > 0
        ? samples.reduce((best, s) => (s.distance_m != null && (best == null || s.distance_m < best.distance_m) ? s : best), null)
        : null;

      const rawDist = closestSample && closestSample.distance_m != null
        ? closestSample.distance_m
        : (pairIncidents.length ? Math.min(...pairIncidents.map((i) => i.magnitude)) : selected.min_distance_m);

      const hasValidDist = rawDist != null && rawDist > 0 && rawDist < 900;
      const distanceText = hasValidDist ? `${rawDist.toFixed(2)} m` : "—";

      const timeVal = closestSample && closestSample.time_s != null ? closestSample.time_s : selected.closest_time_s;
      const timeText = timeVal != null ? `T+${timeVal.toFixed(1)}s` : "";

      const egoSpd = closestSample && closestSample.ego_speed != null ? closestSample.ego_speed : selected.ego_speed_m_s;
      const cpSpd = closestSample && closestSample.counterpart_speed != null ? closestSample.counterpart_speed : selected.counterpart_speed_m_s;
      const egoAcc = closestSample && closestSample.ego_accel != null ? closestSample.ego_accel : selected.ego_accel_m_s2;

      // 3 mutually exclusive encounter evaluation states
      let encounterState = "insufficient_telemetry";
      let statusBadge = "";
      let stvoStatus = "Insufficient data";
      let evidenceText = "";

      if (hasConflict) {
        encounterState = "detected_conflict";
        const isSevere = selected.high_count > 0 || pairIncidents.some((i) => i.severity === "high") || (rawDist != null && rawDist < 1.2);
        statusBadge = `<span class="severity-pill severity-${isSevere ? 'high' : 'medium'}">${isSevere ? 'Critical Conflict' : 'Close Pass'}</span>`;
        stvoStatus = isSevere ? "Non-compliant (< 1.20 m)" : "Below threshold (< 1.50 m)";

        if (pairIncidents.length > 0) {
          evidenceText = pairIncidents.map((i) => i.evidence ? `${i.evidence} [${i.magnitude.toFixed(2)} m]` : `Clearance ${i.magnitude.toFixed(2)} m below threshold`).join(" · ");
        } else if (hasValidDist) {
          evidenceText = `Closest lateral clearance of ${distanceText}${timeText ? ' at ' + timeText : ''}`;
          if (egoSpd != null) evidenceText += ` (ego speed: ${egoSpd.toFixed(1)} m/s`;
          if (cpSpd != null) evidenceText += `, counterpart: ${cpSpd.toFixed(1)} m/s`;
          if (egoAcc != null) evidenceText += `, deceleration: ${egoAcc.toFixed(2)} m/s²`;
          evidenceText += `). Clearance is below the 1.50 m German StVO § 5(4) passing threshold.`;
        } else {
          evidenceText = `Conflict threshold triggered based on counterpart trajectory proximity.`;
        }

        if (selected.ml_probabilities && selected.ml_confidence) {
          evidenceText += ` · [XGBoost ML: ${humanize(selected.status)} (${(selected.ml_confidence * 100).toFixed(1)}% prob)]`;
        }
      } else if (samples.length > 0 || hasValidDist) {
        encounterState = "evaluated_safe";
        statusBadge = `<span class="severity-pill severity-low">Safe Encounter</span>`;
        stvoStatus = "Compliant (≥ 1.50 m maintained)";
        evidenceText = `Evaluated pair encounter: lateral separation remained at or above 1.50 m throughout the interaction (closest recorded clearance: ${distanceText}${timeText ? ' at ' + timeText : ''}`;
        if (egoSpd != null) evidenceText += ` · ego speed: ${egoSpd.toFixed(1)} m/s`;
        if (cpSpd != null) evidenceText += ` · counterpart speed: ${cpSpd.toFixed(1)} m/s`;
        evidenceText += `). No conflict triggered under German StVO § 5(4).`;
      } else {
        encounterState = "insufficient_telemetry";
        statusBadge = `<span class="interaction-status">Insufficient Telemetry</span>`;
        stvoStatus = "No interaction recorded";
        evidenceText = `No spatial proximity encounter recorded between ${primaryLabel} and ${counterpartLabel} in this simulation run.`;
      }

      panel.innerHTML = `
        <div class="interaction-summary">
          <div class="interaction-card"><span>Selected pair</span><strong>${primaryLabel} ↔ ${counterpartLabel}</strong></div>
          <div class="interaction-card"><span>Encounter evaluation</span><strong>${statusBadge}</strong></div>
          <div class="interaction-card"><span>Closest clearance</span><strong>${distanceText}</strong></div>
          <div class="interaction-card"><span>StVO § 5(4) status</span><strong>${stvoStatus}</strong></div>
        </div>
        <div class="pair-evidence-box ${hasConflict ? "is-conflict" : ""}">
          <strong>Physical Telemetry Evidence:</strong> ${evidenceText}
        </div>`;

      window.__selectedEncounterSamples = samples.length > 0 ? samples : null;
      renderAccelChart(document.getElementById("accel-chart"), points, samples);
      renderProximityChart(document.getElementById("proximity-chart"), points, samples);
      renderRoute("route-map", points, pairIncidents, counterpartId, selected, primaryId, ride);
    }

    bikeSelect.onchange = () => {
      populateVehicles();
    };

    vehicleSelect.onchange = () => {
      const primaryId = bikeSelect.value;
      const allCandidates = getCounterpartsForPrimary(primaryId);
      const selected = allCandidates.find((x) => x.counterpart_id === vehicleSelect.value);
      updatePairCard(selected);
    };

    populateVehicles();
  }

  function renderIncidentsTable(incidents) {
    const tbody = document.querySelector("#incidents-table tbody");
    tbody.innerHTML = "";
    if (incidents.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="8" style="font-family: var(--font-ui); color: var(--text-muted);">No incidents flagged on this ride.</td>`;
      tbody.appendChild(tr);
      return;
    }
    incidents.forEach((inc) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${inc.incident_type.replace(/_/g, " ")}</td>
        <td>${inc.conflict_category ? humanize(inc.conflict_category) : "—"}</td>
        <td><span class="severity-pill severity-${inc.severity}">${inc.severity}</span></td>
        <td>${inc.counterpart_id ? `${prettyAgentType(inc.counterpart_agent_type)} · ${inc.counterpart_id}` : "—"}</td>
        <td>${inc.magnitude.toFixed(2)}</td>
        <td><small style="font-family: var(--font-mono); color: var(--text-muted);">${inc.evidence || "Threshold criteria met"}</small></td>
        <td>${inc.lat.toFixed(5)}, ${inc.lon.toFixed(5)}</td>
        <td>${new Date(inc.detected_at).toLocaleTimeString()}</td>`;
      tbody.appendChild(tr);
    });
  }

  async function onResetDashboard() {
    const btn = document.getElementById("reset-dashboard-btn");
    if (!btn) return;
    btn.disabled = true;
    setStatus("busy", "Resetting dashboard…");
    try {
      await api.resetDashboard();
      await loadOverview();
      await loadAllRides();
      showToast("Dashboard reset — all logged rides and incident data were cleared.");
      setStatus("ok", "Dashboard reset");
    } catch (err) {
      setStatus("error", "Reset failed");
      showToast(err.message, true);
    } finally {
      btn.disabled = false;
      setTimeout(() => setStatus(null, "Ready"), 1800);
    }
  }

  // -------------------------------------------------------------------
  // Simulate button + status indicator + toast
  // -------------------------------------------------------------------

  function setStatus(state, text) {
    const dot = document.getElementById("status-dot");
    const label = document.getElementById("status-text");
    dot.className = "status-dot" + (state ? ` is-${state}` : "");
    label.textContent = text;
  }

  let toastTimer = null;
  function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = "toast is-visible" + (isError ? " is-error" : "");
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.className = "toast";
      toast.hidden = true;
    }, 4000);
  }

  function showNetworkResults(ride, conflict) {
    const panel = document.getElementById("network-results-panel");
    if (!panel) return;
    panel.style.display = "block";
    document.getElementById("net-stat-points").textContent = ride.point_count || "7,201";
    document.getElementById("net-stat-distance").textContent = formatKm(ride.distance_m);
    document.getElementById("net-stat-incidents").textContent = ride.incident_count;
    const seedStr = ride.metadata && ride.metadata.seed != null ? ` · Seed: ${ride.metadata.seed}` : "";
    document.getElementById("network-results-sub").textContent =
      `Fixed 60-minute simulation${seedStr} · recorded at ${formatDate(ride.started_at)}`;

    api.getRideInteractions(ride.id).then((interactions) => {
      const pairsEl = document.getElementById("net-stat-pairs");
      if (pairsEl) pairsEl.textContent = interactions.length;
    }).catch(() => {});

    const viewRideBtn = document.getElementById("network-view-ride-btn");
    if (viewRideBtn) {
      viewRideBtn.onclick = () => showRideDetail(ride.id);
    }
  }

  let isSimulating = false;

  async function onSimulateClick() {
    if (isSimulating) {
      console.warn("Simulation already running; duplicate launch prevented.");
      return;
    }
    isSimulating = true;
    const btn = document.getElementById("simulate-btn");
    const netBtn = document.getElementById("network-simulate-btn");
    if (btn) btn.disabled = true;
    if (netBtn) netBtn.disabled = true;
    if (simProgressWrap) simProgressWrap.style.display = "block";
    if (simProgressBar) simProgressBar.style.width = "0%";
    if (simProgressDetail) simProgressDetail.textContent = "Connecting to SUMO runner…";
    setStatus("busy", "Initializing SUMO simulation…");

    try {
      const ride = await api.simulateRide("berlin-multi-traffic", {
        conflict: "all",
        onProgress: (status) => {
          const pct = Math.min(100, Math.max(0, Math.round(status.progress || 0)));
          if (simProgressBar) simProgressBar.style.width = `${pct}%`;
          if (simProgressDetail) {
            simProgressDetail.textContent = `Simulation step ${status.step || 0} / ${status.total_steps || 7201} (${pct}%)`;
          }
          setStatus("busy", `Running SUMO simulation… ${pct}%`);
        },
      });
      if (simProgressBar) simProgressBar.style.width = "100%";
      if (simProgressDetail) simProgressDetail.textContent = "Ingestion complete";
      setStatus("ok", "SUMO ride ingested");
      showToast(`SUMO 60-minute simulation complete — ${ride.incident_count} incident${ride.incident_count === 1 ? "" : "s"} flagged. Overview and heatmap refreshed.`);
      showNetworkResults(ride, "all");
      await loadOverview();
      await loadAllRides();
    } catch (err) {
      setStatus("error", "Simulation failed");
      showToast(err.message, true);
    } finally {
      isSimulating = false;
      if (btn) btn.disabled = false;
      if (netBtn) netBtn.disabled = false;
      setTimeout(() => {
        if (simProgressWrap) simProgressWrap.style.display = "none";
        setStatus(null, "Ready");
      }, 3500);
    }
  }

  // Initial data load
  loadOverview();
  loadAllRides();
});
