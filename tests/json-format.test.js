import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettyJson } from '../src/json-format.js';

test('prettyJson: el resultado es JSON válido e igual al original', () => {
  const samples = [
    { a: 1, b: 'dos', c: null, d: true, e: [1, 2, 3], f: { g: [{ h: 'i' }], j: {} }, k: [] },
    [1, 'x', null, { y: 2 }],
    { texto: 'comillas " y \\ barra, saltos\nde línea y acentos: áéíóú ñ' },
  ];
  for (const v of samples) assert.deepEqual(JSON.parse(prettyJson(v)), v);
});

test('prettyJson: el nivel principal siempre se expande con 2 espacios', () => {
  assert.equal(prettyJson({ status: 'ok' }), '{\n  "status": "ok"\n}');
});

test('prettyJson: objetos pequeños anidados quedan en una línea; los largos se expanden', () => {
  const out = prettyJson({
    endpoints: [{ method: 'GET', path: '/health' }],
    largo: { texto: 'x'.repeat(120) },
  });
  assert.ok(out.includes('    { "method": "GET", "path": "/health" }'));
  assert.ok(out.includes('  "largo": {\n    "texto": "'));
});

test('prettyJson: descarta undefined como JSON.stringify', () => {
  assert.equal(prettyJson({ a: 1, b: undefined }), JSON.stringify({ a: 1 }, null, 2));
});
