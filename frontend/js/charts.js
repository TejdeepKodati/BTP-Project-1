const CHART_THRESHOLDS = {
  accel: { hardBrake: -2.0, emergencyBrake: -3.0, unit: "m/s² (negative = braking)" },
  gyro: { medium: 2.5, high: 4.0, unit: "rad/s" },
  proximity: { medium: 1.5, high: 1.2, unit: "m (lower = closer)" },
};

let accelChartInstance = null;
let gyroChartInstance = null;
let proximityChartInstance = null;

function magnitude(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

function themeColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function formatClock(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function baseDataset(label, data, color, opts = {}) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: opts.dashed ? 1.5 : 2,
    borderDash: opts.dashed ? [5, 4] : undefined,
    pointRadius: opts.points ? 3 : 0,
    showLine: true,
    spanGaps: false,
    tension: opts.dashed ? 0 : 0.2,
    fill: false,
  };
}

function zoomConfig() {
  return {
    pan: { enabled: true, mode: "x", modifierKey: null },
    zoom: {
      wheel: { enabled: true },
      pinch: { enabled: true },
      drag: { enabled: false },
      mode: "x",
    },
  };
}

function baseOptions(unitLabel) {
  const gridColor = themeColor("--border");
  const textColor = themeColor("--text-muted");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: textColor,
          boxWidth: 12,
          boxHeight: 12,
          padding: 12,
          font: { family: "Manrope", size: 11 },
          generateLabels: (chart) => {
            const gen = Chart?.defaults?.plugins?.legend?.labels?.generateLabels;
            const items = gen ? gen(chart) : (chart.data.datasets || []).map((ds, i) => ({
              text: ds.label,
              fillStyle: ds.borderColor || ds.backgroundColor,
              strokeStyle: ds.borderColor || ds.backgroundColor,
              lineWidth: 0,
              lineDash: [],
              hidden: !chart.isDatasetVisible(i),
              datasetIndex: i,
            }));
            items.forEach((item) => {
              item.lineDash = [];
              item.lineWidth = 0;
              item.borderRadius = 0;
              item.pointStyle = "rect";
            });
            return items;
          },
        },
      },
      tooltip: { mode: "index", intersect: false },
      zoom: zoomConfig(),
    },
    scales: {
      x: { ticks: { color: textColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
      y: {
        ticks: { color: textColor },
        grid: { color: gridColor },
        title: { display: true, text: unitLabel, color: textColor, font: { size: 11 } },
      },
    },
  };
}

/**
 * renderAccelChart draws bicycle longitudinal acceleration/deceleration over time.
 * If encounterSamples are provided for a selected counterpart, it plots the encounter's
 * exact second-by-second acceleration curve, plus braking threshold lines at -2.0 and -3.0 m/s².
 */
function renderAccelChart(canvasEl, points, encounterSamples) {
  if (accelChartInstance) accelChartInstance.destroy();
  if (!canvasEl) return;

  const { hardBrake, emergencyBrake, unit } = CHART_THRESHOLDS.accel;
  const amber = themeColor("--amber") || "#f59e0b";
  const danger = themeColor("--danger") || "#ef4444";
  const teal = themeColor("--teal") || "#14b8a6";

  let labels = [];
  let datasets = [];

  if (encounterSamples && encounterSamples.length > 0) {
    labels = encounterSamples.map((s) => "T+" + Math.round(s.time_s) + "s");
    const bikeAccels = encounterSamples.map((s) => (s.ego_accel != null ? s.ego_accel : s.bike_accel_ms2 != null ? s.bike_accel_ms2 : 0));
    const counterpartSpeeds = encounterSamples.map((s) => (s.counterpart_speed != null ? s.counterpart_speed : s.other_speed_ms != null ? s.other_speed_ms : null));

    datasets.push(baseDataset("Bicycle acceleration / deceleration", bikeAccels, teal, { points: true }));
    if (counterpartSpeeds.some((v) => v !== null)) {
      datasets.push(baseDataset("Counterpart speed (m/s)", counterpartSpeeds, "#94a3b8", { dashed: true }));
    }
    datasets.push(baseDataset("Hard braking threshold (-2.0 m/s²)", labels.map(() => hardBrake), amber, { dashed: true }));
    datasets.push(baseDataset("Emergency braking threshold (-3.0 m/s²)", labels.map(() => emergencyBrake), danger, { dashed: true }));
  } else if (points && points.length > 0) {
    labels = points.map((p) => formatClock(p.recorded_at));
    const bikeAccels = points.map((p) => p.lin_accel_x != null ? p.lin_accel_x : 0);

    datasets.push(baseDataset("Longitudinal acceleration / deceleration", bikeAccels, teal, { points: false }));
    datasets.push(baseDataset("Hard braking threshold (-2.0 m/s²)", labels.map(() => hardBrake), amber, { dashed: true }));
    datasets.push(baseDataset("Emergency braking threshold (-3.0 m/s²)", labels.map(() => emergencyBrake), danger, { dashed: true }));
  }

  accelChartInstance = new Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: { labels, datasets },
    options: baseOptions(unit),
  });
}

/**
 * renderGyroChart draws |gyroscope| over time on canvasEl, plus dashed
 * medium/high threshold reference lines.
 */
function renderGyroChart(canvasEl, points) {
  if (gyroChartInstance) gyroChartInstance.destroy();
  if (!canvasEl) return;

  const labels = points.map((p) => formatClock(p.recorded_at));
  const data = points.map((p) => magnitude(p.gyro_a || 0, p.gyro_b || 0, p.gyro_c || 0));
  const { medium, high, unit } = CHART_THRESHOLDS.gyro;

  gyroChartInstance = new Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        baseDataset("Gyroscope magnitude", data, themeColor("--teal") || "#14b8a6"),
        baseDataset("Medium threshold (2.5 rad/s)", labels.map(() => medium), themeColor("--amber") || "#f59e0b", { dashed: true }),
        baseDataset("High threshold (4.0 rad/s)", labels.map(() => high), themeColor("--danger") || "#ef4444", { dashed: true }),
      ],
    },
    options: baseOptions(unit),
  });
}

/**
 * renderProximityChart draws pair interaction distance over time.
 * When encounterSamples are available for a counterpart vehicle, it plots the continuous
 * distance curve alongside German StVO §5(4) lateral clearance thresholds (1.5m and 1.2m).
 */
function renderProximityChart(canvasEl, points, encounterSamples) {
  if (proximityChartInstance) proximityChartInstance.destroy();
  if (!canvasEl) return;

  const { medium, high, unit } = CHART_THRESHOLDS.proximity;
  const amber = themeColor("--amber") || "#f59e0b";
  const danger = themeColor("--danger") || "#ef4444";
  const teal = themeColor("--teal") || "#14b8a6";

  let labels = [];
  let datasets = [];

  if (encounterSamples && encounterSamples.length > 0) {
    labels = encounterSamples.map((s) => "T+" + Math.round(s.time_s) + "s");
    const totalDist = encounterSamples.map((s) => s.distance_m != null ? s.distance_m : null);
    const lateralDist = encounterSamples.map((s) => {
      if (s.lateral_clearance_m != null && s.lateral_clearance_m < 900) return s.lateral_clearance_m;
      if (s.side === "left" || s.side === "right") return s.distance_m;
      return null;
    });

    datasets.push(baseDataset("Interaction distance (m)", totalDist, teal, { points: true }));
    if (lateralDist.some((d) => d !== null)) {
      datasets.push(baseDataset("Lateral clearance (m)", lateralDist, "#38bdf8", { points: true }));
    }
    datasets.push(baseDataset("StVO lateral clearance threshold (1.5 m)", labels.map(() => medium), amber, { dashed: true }));
    datasets.push(baseDataset("Critical clearance threshold (1.2 m)", labels.map(() => high), danger, { dashed: true }));
  } else if (points && points.length > 0) {
    labels = points.map((p) => formatClock(p.recorded_at));
    const data = points.map((p) => {
      const l = p.obs_dist_left_m, r = p.obs_dist_right_m;
      if (l == null && r == null) return null;
      if (l == null) return r;
      if (r == null) return l;
      return Math.min(l, r);
    });

    datasets.push(baseDataset("Closest sensor distance (m)", data, teal, { points: true }));
    datasets.push(baseDataset("StVO clearance threshold (1.5 m)", labels.map(() => medium), amber, { dashed: true }));
    datasets.push(baseDataset("Critical clearance threshold (1.2 m)", labels.map(() => high), danger, { dashed: true }));
  }

  proximityChartInstance = new Chart(canvasEl.getContext("2d"), {
    type: "line",
    data: { labels, datasets },
    options: baseOptions(unit),
  });
}

/** resetChartZoom un-zooms the named chart ("accel" | "gyro" | "proximity"). */
function resetChartZoom(which) {
  const instance = { accel: accelChartInstance, gyro: gyroChartInstance, proximity: proximityChartInstance }[which];
  if (instance && typeof instance.resetZoom === "function") instance.resetZoom();
}
