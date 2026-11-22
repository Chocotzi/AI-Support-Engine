import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceIndex } from '../src/info.js';
import { validateResult } from '../src/contract.js';

test('guía: versión corta del commit y entorno', async () => {
  const j = await serviceIndex({ RENDER_GIT_COMMIT: '06888c82201e57a27f637ed255d4c24c8d9bdfa9', APP_ENV: 'production' });
  assert.equal(j.version, '06888c8');
  assert.equal(j.environment, 'production');
  assert.equal((await serviceIndex({})).version, 'local');
});

test('guía: generative sin llave avisa que responde 503; con llave, qué modelo usa', async () => {
  const sinLlave = await serviceIndex({ LLM_PROVIDER: 'gemini' });
  assert.equal(sinLlave.engines.generative, 'sin proveedor configurado (responde 503)');
  assert.equal(sinLlave.engines.traditional, 'disponible');
  const conLlave = await serviceIndex({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'secreto-de-prueba', LLM_MODEL: 'gemini-x' });
  assert.equal(conLlave.engines.generative, 'disponible (gemini/gemini-x)');
  assert.ok(!JSON.stringify(conLlave).includes('secreto-de-prueba'), 'la llave nunca aparece');
});

test('guía: el ejemplo es una respuesta real que cumple el contrato', async () => {
  const { example } = await serviceIndex({});
  assert.doesNotThrow(() => validateResult(example.response, 'traditional'));
});
