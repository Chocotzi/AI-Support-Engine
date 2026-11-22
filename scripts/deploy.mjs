#!/usr/bin/env node
// GENERACIÓN DEL DESPLIEGUE — pide a Render que despliegue un commit exacto y espera a
// que el entorno lo esté sirviendo.
//
// Lo corre el pipeline (.github/workflows/pipeline.yml) en los jobs de staging y
// producción. Se configura solo con variables de entorno:
//
//   RENDER_DEPLOY_HOOK  URL secreta del deploy hook del servicio (Render > servicio >
//                       Settings > Deploy Hook). Es un secreto: nunca se imprime.
//   APP_URL             URL pública del servicio (https://...onrender.com)
//   DEPLOY_SHA          commit a desplegar (en el pipeline: el que acaba de pasar las pruebas)
//   DEPLOY_ENV          nombre del entorno para los mensajes (staging / production)
//   DEPLOY_TIMEOUT_S    espera máxima; por defecto 900 s (15 min, el límite de Render)
//
// Cómo sabe que terminó: GET /health devuelve "version" (RENDER_GIT_COMMIT). Render no
// cambia el tráfico a la versión nueva hasta que pasa su propio health check, así que en
// cuanto /health reporta DEPLOY_SHA, la versión nueva ya está atendiendo.

import { baseUrl, fail, short, sameVersion, sleep, timedFetch, writeSummary } from './lib/http.mjs';

const env = process.env;
const envName = env.DEPLOY_ENV || 'entorno';
const timeoutS = Number(env.DEPLOY_TIMEOUT_S) || 900;

if (!env.RENDER_DEPLOY_HOOK) fail(`Falta RENDER_DEPLOY_HOOK (secreto del environment "${envName}" en GitHub). Ver docs/CI_CD.md.`);
if (!env.APP_URL) fail(`Falta APP_URL (variable del repo con la URL de ${envName}). Ver docs/CI_CD.md.`);
const sha = env.DEPLOY_SHA || '';
if (!/^[0-9a-f]{7,40}$/i.test(sha)) fail(`DEPLOY_SHA debe ser un SHA de commit (7 a 40 caracteres hex), no "${sha}"`);

let base;
let hook;
try {
  base = baseUrl(env.APP_URL, 'APP_URL');
  hook = new URL(env.RENDER_DEPLOY_HOOK);
} catch (err) {
  fail(err instanceof TypeError ? 'RENDER_DEPLOY_HOOK no es una URL válida' : err.message);
}

console.log(`Despliegue de ${short(sha)} en ${envName} (${base})`);

// 0. Si ya sirve ese commit (por ejemplo, al re-ejecutar el job), no se redepliega.
const current = await timedFetch(`${base}/health`, { timeoutMs: 90_000 });
const currentVersion = current.json?.version;
if (current.status === 200 && sameVersion(currentVersion, sha)) {
  console.log(`✔ ${envName} ya sirve ${short(sha)}; no hace falta desplegar.`);
  writeSummary(`### Despliegue a ${envName}\n\n${short(sha)} ya estaba desplegado en ${base}.`);
  process.exit(0);
}
console.log(`  versión actual: ${current.status === 200 ? short(currentVersion) : current.error || `HTTP ${current.status}`}`);

// 1. Disparar el deploy hook con el commit exacto (?ref=SHA).
hook.searchParams.set('ref', sha);
const started = Date.now();
const res = await timedFetch(hook, { method: 'POST', timeoutMs: 30_000 });

// El cuerpo trae el id del despliegue; se busca cualquier valor "dep-..." para no
// depender de la forma exacta del JSON.
const findDeployId = (v) => {
  if (typeof v === 'string') return /^dep-/.test(v) ? v : null;
  if (v && typeof v === 'object') for (const x of Object.values(v)) { const id = findDeployId(x); if (id) return id; }
  return null;
};

const HOOK_ERRORS = {
  400: 'Render rechazó la petición: el servicio no está conectado a Git o el commit no es válido.',
  401: 'Al deploy hook le falta la llave (?key=...). Copia la URL completa desde Render.',
  404: 'Render no encontró el servicio, la llave del hook o el commit. Si regeneraste el hook, actualiza el secreto RENDER_DEPLOY_HOOK; si el commit no está en GitHub, haz push primero.',
  405: 'Método no permitido por el deploy hook.',
  409: 'El servicio está suspendido o la cuenta no puede desplegar (¿se acabaron las 750 h gratis del mes?).',
};

let deployId = null;
if (res.status === 200) {
  deployId = findDeployId(res.json);
  console.log(`✔ Render aceptó el despliegue${deployId ? ` (${deployId})` : ''}.`);
} else if (res.status === 202) {
  console.log('… Render ya tenía un despliegue en curso; este queda en espera.');
} else {
  fail(res.ok ? `Deploy hook respondió HTTP ${res.status}. ${HOOK_ERRORS[res.status] || ''}` : `No se pudo llamar al deploy hook: ${res.error}`);
}

// 2. Esperar a que /health reporte el commit nuevo.
let last;
while (true) {
  const h = await timedFetch(`${base}/health`, { timeoutMs: 60_000 });
  const secs = Math.round((Date.now() - started) / 1000);
  if (h.status === 200 && sameVersion(h.json?.version, sha)) {
    console.log(`✔ ${envName} sirve ${short(sha)} después de ${secs} s.`);
    writeSummary(
      [
        `### Despliegue a ${envName}`,
        '',
        '| Dato | Valor |',
        '|---|---|',
        `| Commit | \`${short(sha)}\` |`,
        `| Deploy de Render | ${deployId || '(en cola)'} |`,
        `| Versión anterior | \`${short(currentVersion ?? '-')}\` |`,
        `| Duración (hook → sirviendo) | ${secs} s |`,
        `| URL | ${base} |`,
      ].join('\n'),
    );
    process.exit(0);
  }
  const state = h.status === 200 ? `sirve ${short(h.json?.version)} (construyendo la nueva)` : h.ok ? `HTTP ${h.status}` : h.error;
  if (state !== last) {
    console.log(`  ${secs} s: ${state}`);
    last = state;
  }
  if (secs > timeoutS) fail(`${envName} no sirvió ${short(sha)} en ${timeoutS} s. Revisa Events y Logs del servicio en el dashboard de Render.`);
  await sleep(10_000);
}
