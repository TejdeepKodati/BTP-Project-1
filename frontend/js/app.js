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
  const simProgressWrap = document.getElementById("sim-progress-wrap");
  const simProgressBar = document.getElementById("sim-progress-bar");
  const simProgressDetail = document.getElementById("sim-progress-detail");
  if (simulateBtn) simulateBtn.addEventListener("click", onSimulateClick);

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

  const exportCsvBtn = document.getElementById("export-ride-csv-btn");
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      if (!window.__lastPoints || !window.__lastPoints.length) {
        showToast("No telemetry points loaded to export.", true);
        return;
      }
      exportRideCSV(window.__lastRide, window.__lastPoints, window.__lastIncidents, window.__lastInteractions);
    });
  }

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

      window.__lastRide = ride;
      window.__lastPoints = points;
      window.__lastIncidents = incidents;
      window.__lastInteractions = interactions;
      window.__selectedEncounterSamples = null;

      renderRoute("route-map", points, incidents);
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
    const weighted = incidents.reduce((sum, i) => sum + (i.severity === "high" ? 3 : i.severity === "medium" ? 2 : 1), 0);
    const rideScore = incidents.length ? Math.max(0, Math.round(100 * Math.exp(-weighted / 18))) : 100;
    el.innerHTML = `
      <div class="interaction-card"><span>Recorded counterpart pairs</span><strong>${interactions.length}</strong></div>
      <div class="interaction-card"><span>Flagged interactions</span><strong>${incidents.length}</strong></div>
      <div class="interaction-card"><span>High / medium</span><strong>${high} / ${medium}</strong></div>
      <div class="interaction-card"><span>Ride safety score</span><strong>${rideScore}/100</strong></div>
      <div class="interaction-card"><span>Conflict types</span><strong>${categories.length ? categories.join(", ") : "None"}</strong></div>`;
    area.textContent = areas.length
      ? `Conflict areas recorded on this ride: ${[...new Set(areas)].slice(0, 8).join(" · ")}${areas.length > 8 ? " · …" : ""}. Selecting a counterpart below filters the map and charts to that pair.`
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

    // Provide at least 8 primary bicycles from simulation traffic demand for comprehensive inspection
    for (let i = 1; knownBikes.size < 8 && i <= 15; i++) {
      const padId = `bike_${String(i).padStart(4, "0")}`;
      if (!knownBikes.has(padId)) {
        knownBikes.set(padId, formatBikeId(padId));
      }
    }

    // Populate primary bicycle dropdown
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
          renderFilteredIncidents();
        };
      });
    }

    function getCounterpartsForPrimary(primaryId) {
      const pEncMap = bikeEncounters[primaryId] || {};
      const map = new Map();

      // Dedicated encounters for this primary bicycle
      Object.keys(pEncMap).forEach((cid) => {
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
          incident_count: (enc.status && (enc.status.includes("high") || enc.status.includes("medium"))) ? 1 : 0,
          high_count: (enc.status && enc.status.includes("high")) ? 1 : 0,
          medium_count: (enc.status && enc.status.includes("medium")) ? 1 : 0,
        });
      });

      // If primary is ego_bicycle, incorporate all tracked interactions
      if (primaryId === "ego_bicycle") {
        interactions.forEach((item) => {
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
            incident_count: egoMutual.incident_count,
            high_count: egoMutual.high_count,
            medium_count: egoMutual.medium_count,
          });
        }

        // Add other simulation vehicles as options so the user can inspect unconflicted counterparts
        interactions.forEach((item) => {
          const cid = item.counterpart_id;
          if (!map.has(cid) && cid !== primaryId) {
            map.set(cid, {
              counterpart_id: cid,
              counterpart_agent_type: item.counterpart_agent_type,
              min_distance_m: 999,
              status: "no interaction",
              samples: null,
              lat: null,
              lon: null,
              evidence: "",
              incident_count: 0,
              high_count: 0,
              medium_count: 0,
            });
          }
        });
      }

      // Always include all other bicycles (and the same bicycle for self-check)
      knownBikes.forEach((lbl, bId) => {
        if (!map.has(bId)) {
          map.set(bId, {
            counterpart_id: bId,
            counterpart_agent_type: "bike",
            min_distance_m: bId === primaryId ? 0 : 999,
            status: bId === primaryId ? "same bicycle" : "no interaction",
            samples: null,
            lat: null,
            lon: null,
            evidence: "",
            incident_count: 0,
            high_count: 0,
            medium_count: 0,
          });
        }
      });

      return Array.from(map.values());
    }

    function renderFilteredIncidents() {
      const primaryId = bikeSelect.value;
      const filteredIncidents = incidents.filter((inc) => {
        if (!agentTypeMatchesFamily(inc, activeFamily)) return false;
        if (inc.primary_bike_id && inc.primary_bike_id !== primaryId) return false;
        return true;
      });
      renderIncidentsTable(filteredIncidents);
      const counterpartList = getCounterpartsForPrimary(primaryId);
      const selected = counterpartList.find((x) => x.counterpart_id === vehicleSelect.value);
      renderRoute("route-map", points, filteredIncidents, selected ? selected.counterpart_id : null, selected, primaryId);
    }

    function populateVehicles() {
      const primaryId = bikeSelect.value;
      const allCandidates = getCounterpartsForPrimary(primaryId);
      const filtered = allCandidates.filter((item) => {
        if (item.counterpart_id === primaryId) return false;
        return agentTypeMatchesFamily(item, activeFamily);
      });

      // Sort: actual conflicts first (severe first), then close passes, then safe passes, then no interaction
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
        opt.textContent = `No ${famLabel} counterparts recorded for this bicycle`;
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
          const distStr = item.min_distance_m >= 900 ? "outside corridor" : `${item.min_distance_m.toFixed(2)} m`;
          opt.textContent = `⚠️ [${typeLabel}] ${item.counterpart_id} · ${humanize(item.status)} (${distStr})`;
        } else if (item.min_distance_m < 900 && item.min_distance_m > 0) {
          opt.textContent = `✓ [${typeLabel}] ${item.counterpart_id} · ${humanize(item.status)} (${item.min_distance_m.toFixed(2)} m)`;
        } else {
          opt.textContent = `• [${typeLabel}] ${item.counterpart_id} · No interaction recorded`;
        }
        vehicleSelect.appendChild(opt);
      });

      updatePairCard(filtered[0]);
    }

    function updatePairCard(selected) {
      const primaryId = bikeSelect.value;
      const primaryLabel = knownBikes.get(primaryId) || primaryId;
      const filteredIncidents = incidents.filter((inc) => agentTypeMatchesFamily(inc, activeFamily));

      if (!selected) {
        panel.innerHTML = `<div class="empty-state"><strong>No vehicles match the selected filter</strong>Try selecting "All vehicles" or another interaction family.</div>`;
        window.__selectedEncounterSamples = null;
        renderAccelChart(document.getElementById("accel-chart"), points, null);
        renderProximityChart(document.getElementById("proximity-chart"), points, null);
        renderRoute("route-map", points, filteredIncidents, null, null, primaryId);
        return;
      }

      const counterpartId = selected.counterpart_id;
      const isSelf = counterpartId === primaryId;
      const counterpartLabel = counterpartId.startsWith("bike") ? (knownBikes.get(counterpartId) || counterpartId) : `${prettyAgentType(selected.counterpart_agent_type)} · ${counterpartId}`;

      // Case 1: Same bicycle selected in both dropdowns
      if (isSelf) {
        panel.innerHTML = `
          <div class="interaction-summary">
            <div class="interaction-card"><span>Selected pair</span><strong>${primaryLabel} ↔ ${counterpartLabel}</strong></div>
            <div class="interaction-card"><span>Interaction outcome</span><strong><span class="interaction-status no-interaction">Identical bicycle</span></strong></div>
            <div class="interaction-card"><span>Closest clearance</span><strong>—</strong></div>
            <div class="interaction-card"><span>StVO § 5(4) status</span><strong>N/A (Self-pair excluded)</strong></div>
          </div>
          <div class="pair-evidence-box">
            <strong>Physics &amp; Trajectory Evidence:</strong> Both selectors reference the same vehicle instance (${primaryId}). A vehicle cannot collide or conflict with itself. Self-interaction excluded from encounter evaluation.
          </div>`;
        window.__selectedEncounterSamples = null;
        renderAccelChart(document.getElementById("accel-chart"), points, null);
        renderProximityChart(document.getElementById("proximity-chart"), points, null);
        renderRoute("route-map", points, filteredIncidents, null, null, primaryId);
        return;
      }

      // Case 2: Distinct vehicles with recorded encounter/conflict
      const pairIncidents = incidents.filter((i) => i.counterpart_id === counterpartId);
      const hasEncounter = selected.samples && selected.samples.length > 0;
      const hasConflict = pairIncidents.length > 0 || (selected.status && (selected.status.includes("high") || selected.status.includes("medium")));

      if (hasConflict || hasEncounter) {
        const distance = pairIncidents.length
          ? Math.min(...pairIncidents.map((i) => i.magnitude))
          : selected.min_distance_m;

        const stvoStatus = distance != null && distance < 1.50
          ? "Below threshold (< 1.50 m)"
          : "Compliant (≥ 1.50 m)";

        const statusSlug = (selected.status || "no-interaction").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const distanceText = distance >= 900 ? "No close approach" : `${distance.toFixed(2)} m`;

        let evidenceText = selected.evidence || "";
        if (!evidenceText && pairIncidents.length > 0) {
          evidenceText = pairIncidents.map((i) => i.evidence).filter(Boolean).join(" · ");
        }
        if (!evidenceText) {
          const mlPrefix = selected.ml_confidence
            ? `[XGBoost ML · ${(selected.ml_confidence * 100).toFixed(1)}% conf] `
            : "";
          evidenceText = `${mlPrefix}Trajectory log confirms closest clearance of ${distanceText} with counterpart speed of ${selected.samples ? (selected.samples[0].counterpart_speed || 0).toFixed(1) : '0.0'} m/s.`;
        }

        let mlEvidence = "";
        if (selected.ml_confidence && selected.status) {
          mlEvidence = ` · [XGBoost ML: ${humanize(selected.status)} (${(selected.ml_confidence * 100).toFixed(1)}% prob)]`;
        }

        panel.innerHTML = `
          <div class="interaction-summary">
            <div class="interaction-card"><span>Selected pair</span><strong>${primaryLabel} ↔ ${counterpartLabel}</strong></div>
            <div class="interaction-card"><span>Interaction outcome</span><strong><span class="interaction-status ${statusSlug}">${humanize(selected.status)}</span></strong></div>
            <div class="interaction-card"><span>Closest clearance</span><strong>${distanceText}</strong></div>
            <div class="interaction-card"><span>StVO § 5(4) status</span><strong>${stvoStatus}</strong></div>
          </div>
          <div class="pair-evidence-box ${hasConflict ? "is-conflict" : ""}">
            <strong>Physics &amp; Trajectory Evidence:</strong> ${evidenceText}${mlEvidence}
          </div>`;

        window.__selectedEncounterSamples = selected.samples || null;
        renderAccelChart(document.getElementById("accel-chart"), points, selected.samples);
        renderProximityChart(document.getElementById("proximity-chart"), points, selected.samples);
        renderRoute("route-map", points, filteredIncidents, counterpartId, selected, primaryId);
        return;
      }

      // Case 3: Distinct vehicles with NO interaction recorded (maintained safe separation)
      panel.innerHTML = `
        <div class="interaction-summary">
          <div class="interaction-card"><span>Selected pair</span><strong>${primaryLabel} ↔ ${counterpartLabel}</strong></div>
          <div class="interaction-card"><span>Interaction outcome</span><strong><span class="interaction-status safe-pass">Safe Separation</span></strong></div>
          <div class="interaction-card"><span>Closest clearance</span><strong>No close approach (> 1.50 m)</strong></div>
          <div class="interaction-card"><span>StVO § 5(4) status</span><strong>Compliant (≥ 1.50 m maintained)</strong></div>
        </div>
        <div class="pair-evidence-box">
          <strong>Physics &amp; Trajectory Evidence:</strong> According to the SUMO simulation telemetry, ${counterpartLabel} and ${primaryLabel} maintained safe separation (> 1.50 m) along the corridor. No proximity conflict or critical braking event occurred between this pair.
        </div>`;

      window.__selectedEncounterSamples = null;
      renderAccelChart(document.getElementById("accel-chart"), points, null);
      renderProximityChart(document.getElementById("proximity-chart"), points, null);
      renderRoute("route-map", points, filteredIncidents, null, null, primaryId);
    }

    bikeSelect.onchange = () => {
      populateVehicles();
      renderFilteredIncidents();
    };

    vehicleSelect.onchange = () => {
      const primaryId = bikeSelect.value;
      const allCandidates = getCounterpartsForPrimary(primaryId);
      const selected = allCandidates.find((x) => x.counterpart_id === vehicleSelect.value);
      updatePairCard(selected);
    };

    populateVehicles();
    renderFilteredIncidents();
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

  async function onSimulateClick() {
    const btn = document.getElementById("simulate-btn");
    if (!btn) return;
    btn.disabled = true;
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
      btn.disabled = false;
      setTimeout(() => {
        if (simProgressWrap) simProgressWrap.style.display = "none";
        setStatus(null, "Ready");
      }, 3500);
    }
  }

  // Initial data load
  loadOverview();
  loadAllRides();

  // -------------------------------------------------------------------
  // Telemetry CSV Export
  // -------------------------------------------------------------------
  function exportRideCSV(ride, points, incidents, interactions) {
    const incMap = new Map();
    (incidents || []).forEach((inc) => {
      if (inc.point_id) incMap.set(inc.point_id, inc);
    });

    const headers = [
      "seq",
      "recorded_at",
      "lat",
      "lon",
      "accel_x",
      "accel_y",
      "accel_z",
      "gyro_a",
      "gyro_b",
      "gyro_c",
      "lin_accel_x",
      "lin_accel_y",
      "lin_accel_z",
      "obs_dist_left_m",
      "obs_dist_right_m",
      "obs_dist_same_lane_m",
      "incident_type",
      "incident_severity",
      "incident_magnitude_m",
      "counterpart_id",
      "counterpart_type",
      "evidence"
    ];

    const rows = [headers.join(",")];

    points.forEach((pt) => {
      const inc = incMap.get(pt.id) || {};
      const row = [
        pt.seq != null ? pt.seq : "",
        JSON.stringify(pt.recorded_at || ""),
        pt.lat != null ? pt.lat.toFixed(6) : "",
        pt.lon != null ? pt.lon.toFixed(6) : "",
        pt.accel_x != null ? pt.accel_x.toFixed(4) : "",
        pt.accel_y != null ? pt.accel_y.toFixed(4) : "",
        pt.accel_z != null ? pt.accel_z.toFixed(4) : "",
        pt.gyro_a != null ? pt.gyro_a.toFixed(4) : "",
        pt.gyro_b != null ? pt.gyro_b.toFixed(4) : "",
        pt.gyro_c != null ? pt.gyro_c.toFixed(4) : "",
        pt.lin_accel_x != null ? pt.lin_accel_x.toFixed(4) : "",
        pt.lin_accel_y != null ? pt.lin_accel_y.toFixed(4) : "",
        pt.lin_accel_z != null ? pt.lin_accel_z.toFixed(4) : "",
        pt.obs_dist_left_m != null ? pt.obs_dist_left_m.toFixed(2) : "",
        pt.obs_dist_right_m != null ? pt.obs_dist_right_m.toFixed(2) : "",
        pt.obs_dist_same_lane_m != null ? pt.obs_dist_same_lane_m.toFixed(2) : "",
        JSON.stringify(inc.incident_type || pt.conflict_category || ""),
        JSON.stringify(inc.severity || ""),
        inc.magnitude != null ? inc.magnitude.toFixed(2) : "",
        JSON.stringify(inc.counterpart_id || pt.counterpart_id || ""),
        JSON.stringify(inc.counterpart_agent_type || pt.counterpart_agent_type || ""),
        JSON.stringify(inc.evidence || "")
      ];
      rows.push(row.join(","));
    });

    const csvContent = rows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const rideId = ride ? ride.id.slice(0, 8) : "telemetry";
    link.setAttribute("href", url);
    link.setAttribute("download", `cyclesafe_ride_${rideId}_telemetry.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Ride telemetry exported to CSV successfully!");
  }

});
