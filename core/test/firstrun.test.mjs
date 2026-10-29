import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from './helpers.mjs';

test('first launch: the catalogue is there before setup (read-only mode shows real resources)', async () => {
  sandbox('firstrun');
  process.env.CURI_NO_STARTUP_SCAN = '1';
  const { startServer } = await import('../src/server.mjs');
  const s = await startServer({ port: 0, token: 'firstrun-token-0123456789abcdef' });
  try {
    assert.ok(s.launch.seeded > 100, `seeded ${s.launch.seeded}`);
    assert.equal(s.launch.state, 'UNINITIALIZED');
  } finally { await s.close(); }
});
