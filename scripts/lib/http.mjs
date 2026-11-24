// Utilidades compartidas por los scripts del pipeline (deploy, smoke-test y monitor).
// Solo Node nativo (fetch), igual que el servidor: en CI no hay nada que instalar.

import { appendFileSync } from 'node:fs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const elapsed = (started) => Math.round((performance.now() - started) * 10) / 10;

// fetch con tiempo límite y medición de latencia. Nunca lanza: devuelve { ok: false, error }.
export async function timedFetch(url, { method = 'GET', body, headers = {}, timeoutMs = 30_000 } = {}) {
  const started = performance.now();
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['content-type'] ??= 'application/json';
  }
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // no es JSON (por ejemplo, la página de "despertando" de Render)
    }
    return { ok: true, status: res.status, headers: res.headers, json, text, ms: elapsed(started) };
  } catch (err) {
    const error = err?.name === 'TimeoutError' ? `sin respuesta en ${timeoutMs / 1000} s` : err?.cause?.code || err?.message || String(err);
    return { ok: false, status: 0, headers: null, json: null, text: '', ms: elapsed(started), error };
  }
}

export function baseUrl(value, name = 'URL') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} no es una URL válida: "${value ?? ''}"`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} debe empezar con http:// o https://`);
  return url.origin + url.pathname.replace(/\/+$/, '');
}

// Un SHA corto (7+) y uno completo son la misma versión si uno es prefijo del otro.
export function sameVersion(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length < 7 || b.length < 7) return false;
  return a.startsWith(b) || b.startsWith(a);
}

export const short = (sha) => (typeof sha === 'string' && /^[0-9a-f]{7,}$/i.test(sha) ? sha.slice(0, 7) : String(sha));

// Espera a que /health responda 200 {status:"ok"}. En el plan gratis de Render el servicio
// se apaga tras 15 min sin tráfico y tarda alrededor de un minuto en despertar.
export async function waitForHealthy(base, { timeoutS = 180, onWait = () => {} } = {}) {
  const deadline = Date.now() + timeoutS * 1000;
  const started = performance.now();
  let last;
  while (true) {
    const r = await timedFetch(`${base}/health`, { timeoutMs: 90_000 });
    if (r.status === 200 && r.json?.status === 'ok') return { ...r, waitedMs: elapsed(started) };
    last = r.ok ? `HTTP ${r.status}` : r.error;
    if (Date.now() > deadline) throw new Error(`${base}/health no respondió "ok" en ${timeoutS} s (último intento: ${last})`);
    onWait(last);
    await sleep(5000);
  }
}

// Resumen en la página de la corrida de GitHub Actions (y no hace nada fuera de CI).
export function writeSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
}

export function fail(message) {
  console.error(`\n✘ ${message}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error::${message.replace(/\r?\n/g, ' ')}`);
  process.exit(1);
}
