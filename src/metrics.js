// MONITOREO — métricas en memoria que expone GET /metrics (y la versión de GET /health).
//
// Se cuentan desde que arranca el proceso: un despliegue, un reinicio o el apagado por
// inactividad del plan gratis de Render las reinician. La historia larga la guarda el
// monitor del pipeline (scripts/monitor.mjs, cada hora).
// Solo se guardan tiempos y códigos de respuesta, NUNCA el contenido de los mensajes.

const LATENCY_WINDOW = 500; // últimas N latencias por motor para calcular p50/p95

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

// Versión desplegada: Render define RENDER_GIT_COMMIT; en CI y en local la pone el
// Dockerfile (APP_VERSION). El pipeline la usa para saber cuándo terminó un despliegue.
export function appInfo(env = process.env) {
  return {
    version: env.RENDER_GIT_COMMIT || env.APP_VERSION || 'local',
    environment: env.APP_ENV || 'local',
  };
}

export function createMetrics({ now = Date.now, env = process.env } = {}) {
  const startedAt = now();
  const byClass = { '2xx': 0, '4xx': 0, '5xx': 0 };
  const engines = new Map(); // mode -> { requests, errors, latencies[] }
  let total = 0;

  const round = (n) => (n === null ? null : Math.round(n * 100) / 100);

  return {
    uptimeSeconds: () => Math.round((now() - startedAt) / 1000),

    record({ status, ms, mode }) {
      total += 1;
      const cls = `${Math.floor(status / 100)}xx`;
      if (cls in byClass) byClass[cls] += 1;
      if (!mode) return; // la petición falló antes de saber qué motor pedía
      let e = engines.get(mode);
      if (!e) {
        e = { requests: 0, errors: 0, latencies: [] };
        engines.set(mode, e);
      }
      e.requests += 1;
      if (status >= 500) e.errors += 1;
      e.latencies.push(ms);
      if (e.latencies.length > LATENCY_WINDOW) e.latencies.shift();
    },

    snapshot() {
      const perEngine = {};
      for (const [mode, e] of engines) {
        perEngine[mode] = {
          requests: e.requests,
          errors5xx: e.errors,
          p50Ms: round(percentile(e.latencies, 50)),
          p95Ms: round(percentile(e.latencies, 95)),
          maxMs: round(e.latencies.length ? Math.max(...e.latencies) : null),
        };
      }
      return {
        ...appInfo(env),
        startedAt: new Date(startedAt).toISOString(),
        uptimeSeconds: Math.round((now() - startedAt) / 1000),
        requests: { total, ...byClass },
        errorRate5xx: total ? round(byClass['5xx'] / total) : 0,
        engines: perEngine,
      };
    },
  };
}
