import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { analyze } from '../src/service.js';
import { ProviderError } from '../src/providers.js';
import { GenerativeFormatError } from '../src/generative.js';
import { MLModelError } from '../src/ml.js';

let server;
let base;
let nextError = null;

before(async () => {
  const analyzeFn = async (m, mode) => {
    if (nextError) throw nextError;
    return analyze(m, mode);
  };
  server = createServer({ analyzeFn, log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (body, headers = { 'content-type': 'application/json' }) =>
  fetch(`${base}/api/analyze`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('200 modo traditional con el contrato completo', async () => {
  const res = await post({ message: 'No puedo iniciar sesión', mode: 'traditional' });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.category, 'ACCESS');
  assert.equal(j.mode, 'traditional');
  assert.equal(typeof j.requiresHumanReview, 'boolean');
});

test('200 modo ml con el contrato completo', async () => {
  const res = await post({ message: 'No puedo iniciar sesión', mode: 'ml' });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(Object.keys(j).sort(), ['category', 'mode', 'priority', 'requiresHumanReview', 'response']);
  assert.equal(j.mode, 'ml');
});

test('400 por entradas inválidas', async () => {
  for (const body of [
    { mode: 'traditional' },
    { message: '   ', mode: 'traditional' },
    { message: 123, mode: 'traditional' },
    { message: 'hola', mode: 'otro' },
    { message: 'hola' },
    { message: 'a'.repeat(2001), mode: 'traditional' },
    [],
  ]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await post('{no es json')).status, 400);
});

test('413, 415, 404 y 405', async () => {
  // Sin .catch: el cliente debe RECIBIR el 413, no un corte de conexión.
  const big = await post({ message: 'x'.repeat(20000), mode: 'traditional' });
  assert.equal(big.status, 413);
  assert.equal((await big.json()).error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal((await post('x', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${base}/otra`)).status, 404);
  assert.equal((await fetch(`${base}/api/analyze`)).status, 405);
});

test('errores del proveedor -> códigos seguros sin detalles internos', async () => {
  const cases = [
    [new ProviderError('PROVIDER_TIMEOUT', 'secreto-interno'), 504],
    [new ProviderError('PROVIDER_NOT_CONFIGURED', 'secreto-interno'), 503],
    [new ProviderError('PROVIDER_HTTP', 'secreto-interno', 500), 502],
    [new ProviderError('PROVIDER_BLOCKED', 'secreto-interno'), 502],
    [new GenerativeFormatError('secreto-interno'), 502],
    [new MLModelError('secreto-interno'), 503],
    [new Error('boom secreto-interno'), 500],
  ];
  for (const [err, status] of cases) {
    nextError = err;
    const res = await post({ message: 'hola', mode: 'generative' });
    assert.equal(res.status, status);
    assert.ok(!(await res.text()).includes('secreto-interno'));
  }
  nextError = null;
});

test('GET /health informa versión, entorno y tiempo activo', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.status, 'ok');
  assert.equal(typeof j.version, 'string');
  assert.equal(typeof j.environment, 'string');
  assert.equal(typeof j.uptimeSeconds, 'number');
});

test('GET /metrics cuenta /api/analyze por motor y no cuenta /health', async () => {
  const before = await (await fetch(`${base}/metrics`)).json();
  await post({ message: 'No puedo iniciar sesión', mode: 'traditional' });
  await post({ mode: 'traditional' }); // 400: se cuenta, pero sin motor
  await fetch(`${base}/health`);
  const after = await (await fetch(`${base}/metrics`)).json();
  assert.equal(after.requests.total, before.requests.total + 2);
  assert.equal(after.requests['2xx'], before.requests['2xx'] + 1);
  assert.equal(after.requests['4xx'], before.requests['4xx'] + 1);
  assert.equal(after.engines.traditional.requests, (before.engines.traditional?.requests ?? 0) + 1);
  assert.equal(typeof after.engines.traditional.p95Ms, 'number');
  assert.ok(!JSON.stringify(after).includes('iniciar sesión'), 'las métricas no guardan mensajes');
});
