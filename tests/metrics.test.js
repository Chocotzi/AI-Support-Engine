import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appInfo, createMetrics, percentile } from '../src/metrics.js';

test('percentile: p50 y p95 de una lista conocida', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  assert.equal(percentile(values, 50), 50);
  assert.equal(percentile(values, 95), 95);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 95), null);
});

test('appInfo: Render manda sobre APP_VERSION; sin nada es "local"', () => {
  assert.deepEqual(appInfo({}), { version: 'local', environment: 'local' });
  assert.equal(appInfo({ APP_VERSION: 'abc1234' }).version, 'abc1234');
  assert.equal(appInfo({ APP_VERSION: 'abc1234', RENDER_GIT_COMMIT: 'def5678' }).version, 'def5678');
  assert.equal(appInfo({ APP_ENV: 'staging' }).environment, 'staging');
});

test('createMetrics: cuenta por clase de estado y por motor', () => {
  let t = 1_000_000;
  const m = createMetrics({ now: () => t, env: { APP_ENV: 'test' } });
  m.record({ status: 200, ms: 2, mode: 'traditional' });
  m.record({ status: 200, ms: 4, mode: 'traditional' });
  m.record({ status: 503, ms: 1, mode: 'generative' });
  m.record({ status: 400, ms: 1 });
  t += 5000;
  const s = m.snapshot();
  assert.equal(s.environment, 'test');
  assert.equal(s.uptimeSeconds, 5);
  assert.deepEqual(s.requests, { total: 4, '2xx': 2, '4xx': 1, '5xx': 1 });
  assert.equal(s.errorRate5xx, 0.25);
  assert.equal(s.engines.traditional.requests, 2);
  assert.equal(s.engines.traditional.p95Ms, 4);
  assert.equal(s.engines.generative.errors5xx, 1);
});
