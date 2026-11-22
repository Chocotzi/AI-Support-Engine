#!/usr/bin/env node
// MONITOREO — revisión sintética de un entorno desplegado contra los niveles de servicio.
// Lo corre .github/workflows/monitor.yml cada hora contra producción; si falla, GitHub
// avisa por correo (esa es la alerta).
//
// Uso:
//   node scripts/monitor.mjs <url>
//   npm run monitor -- https://ai-support-engine-production.onrender.com
//
// Métricas que mide (ver docs/CI_CD.md, "Niveles de servicio"):
//   - disponibilidad: /health responde ok
//   - arranque en frío: tiempo hasta la primera respuesta (el plan gratis se apaga tras 15 min)
//   - latencia p50/p95 de /health y de /api/analyze en caliente
//   - tasa de errores 5xx de la muestra
//   - lo que reporta el propio servidor en /metrics (desde su último arranque)

import { percentile } from '../src/metrics.js';
import { baseUrl, fail, short, timedFetch, waitForHealthy, writeSummary } from './lib/http.mjs';

const SLO = { p95Ms: 1000, coldStartMs: 90_000 };
const SAMPLES = Number(process.env.MONITOR_SAMPLES) || 10;

let base;
try {
  base = baseUrl(process.argv[2] || process.env.APP_URL, 'URL');
} catch (err) {
  fail(`${err.message}\nUso: node scripts/monitor.mjs <url>`);
}

const checkedAt = new Date().toISOString();
let first;
try {
  first = await waitForHealthy(base, { timeoutS: 150 });
} catch (err) {
  writeSummary(`### Monitor ${checkedAt}\n\n✘ **${base} no disponible**: ${err.message}`);
  fail(`No disponible: ${err.message}`);
}

async function sample(fn) {
  const times = [];
  let errors5xx = 0;
  let failures = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const r = await fn();
    if (!r.ok) failures++;
    else if (r.status >= 500) errors5xx++;
    else times.push(r.ms);
  }
  return { p50: percentile(times, 50), p95: percentile(times, 95), errors5xx, failures };
}

const health = await sample(() => timedFetch(`${base}/health`));
const api = await sample(() =>
  timedFetch(`${base}/api/analyze`, { method: 'POST', body: { message: 'No puedo iniciar sesión', mode: 'traditional' } }),
);
const server = (await timedFetch(`${base}/metrics`)).json;

const total = SAMPLES * 2;
const bad = health.errors5xx + health.failures + api.errors5xx + api.failures;
const report = {
  checkedAt,
  url: base,
  version: first.json.version,
  environment: first.json.environment,
  firstResponseMs: first.waitedMs,
  coldStart: first.waitedMs > 5000,
  health: { p50Ms: health.p50, p95Ms: health.p95 },
  analyze: { p50Ms: api.p50, p95Ms: api.p95 },
  sampleErrorRate: bad / total,
  server: server && { uptimeSeconds: server.uptimeSeconds, requests: server.requests, errorRate5xx: server.errorRate5xx },
};

const ok = (v) => (v ? '✔' : '✘');
const p95Ok = api.p95 !== null && api.p95 <= SLO.p95Ms;
const coldOk = first.waitedMs <= SLO.coldStartMs;
const rows = [
  ['Disponible', '/health = ok', ok(true), `versión ${short(report.version)} (${report.environment})`],
  ['Primera respuesta', `≤ ${SLO.coldStartMs / 1000} s`, ok(coldOk), `${first.waitedMs} ms${report.coldStart ? ' (arranque en frío)' : ''}`],
  ['Latencia /api/analyze', `p95 ≤ ${SLO.p95Ms} ms`, ok(p95Ok), `p50 ${api.p50} ms · p95 ${api.p95} ms`],
  ['Latencia /health', '—', '', `p50 ${health.p50} ms · p95 ${health.p95} ms`],
  ['Errores en la muestra', '0 de ' + total, ok(bad === 0), `${bad} de ${total}`],
  // Los 503 del generative sin llave son esperados, por eso se separan los 5xx del traditional.
  ['Servidor (/metrics)', '—', '', server ? `${server.requests.total} peticiones desde el arranque · 5xx traditional ${server.engines?.traditional?.errors5xx ?? 0} · 5xx global ${(server.errorRate5xx * 100).toFixed(2)} % · activo ${server.uptimeSeconds} s` : 'sin datos'],
];

console.log(`Monitor de ${base} · ${checkedAt}\n`);
for (const [name, target, status, value] of rows) console.log(`${status || ' '} ${name.padEnd(24)} ${value}  (objetivo: ${target})`);
console.log(`\n${JSON.stringify(report)}`);

writeSummary(
  [
    `### Monitor de ${base}`,
    '',
    `Revisado: ${checkedAt}`,
    '',
    '| Métrica | Objetivo | Estado | Valor |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n'),
);

// Alerta (job en rojo) si hay errores; aviso si solo se excede la latencia.
if (!p95Ok || !coldOk) console.log(`::warning::${base}: latencia fuera del objetivo (p95 ${api.p95} ms, primera respuesta ${first.waitedMs} ms)`);
if (bad > 0) fail(`${bad} de ${total} peticiones fallaron en ${base}`);
