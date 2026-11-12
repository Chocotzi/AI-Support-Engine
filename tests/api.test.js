import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { analyze } from '../src/service.js';
import { ProviderError } from '../src/providers.js';
import { GenerativeFormatError } from '../src/generative.js';

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
  assert.equal((await post({ message: 'x'.repeat(20000), mode: 'traditional' }).catch(() => ({ status: 413 }))).status, 413);
  assert.equal((await post('x', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${base}/otra`)).status, 404);
  assert.equal((await fetch(`${base}/api/analyze`)).status, 405);
});

test('errores del proveedor -> códigos seguros sin detalles internos', async () => {
  const cases = [
    [new ProviderError('PROVIDER_TIMEOUT', 'secreto-interno'), 504],
    [new ProviderError('PROVIDER_NOT_CONFIGURED', 'secreto-interno'), 503],
    [new ProviderError('PROVIDER_HTTP', 'secreto-interno', 500), 502],
    [new GenerativeFormatError('secreto-interno'), 502],
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
