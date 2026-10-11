const API_BASE = "/api";

async function apiRequest(path, options) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch (_) {
      /* response wasn't JSON — keep the generic message */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function pollSimulationJob(jobId, onProgress) {
  const pollIntervalMs = 1200;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const status = await api.getSimulateStatus(jobId);
    if (onProgress && typeof onProgress === "function") {
      onProgress(status);
    }
    if (status.status === "completed") {
      return status.ride;
    }
    if (status.status === "failed") {
      throw new Error(status.error || "Simulation failed in SUMO runner");
    }
  }
}

const api = {
  listRides: () => apiRequest("/rides"),
  getRide: (id) => apiRequest(`/rides/${id}`),
  getRidePoints: (id) => apiRequest(`/rides/${id}/points`),
  getRideIncidents: (id) => apiRequest(`/rides/${id}/incidents`),
  getRideInteractions: (id) => apiRequest(`/rides/${id}/interactions`),
  getOverview: () => apiRequest("/stats/overview"),
  getHeatmap: () => apiRequest("/stats/heatmap"),
  resetDashboard: () => apiRequest("/reset", { method: "POST" }),
  getSimulateStatus: (jobId) => apiRequest(`/simulate/status?job_id=${encodeURIComponent(jobId)}`),
  simulateRide: async (scenarioId, options = {}) => {
    const params = new URLSearchParams();
    if (scenarioId) params.set("scenario", scenarioId);
    if (options.window) params.set("window", options.window);
    if (options.conflict) params.set("conflict", options.conflict);
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await apiRequest(`/simulate${query}`, { method: "POST" });
    if (res && res.job_id && res.status === "running") {
      return pollSimulationJob(res.job_id, options.onProgress);
    }
    return res;
  },
  getNetworkConfig: (scenarioId) => {
    const query = scenarioId ? `?scenario=${encodeURIComponent(scenarioId)}` : "";
    return apiRequest(`/network/config${query}`);
  },
};
