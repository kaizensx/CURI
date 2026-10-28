import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/tray.mjs';

test('menu bar summary puts the most pressing thing first', () => {
  assert.equal(summarize({ running: 2, waiting: 1, suggestions: 3 }), 'Working on 2 tasks…');
  assert.equal(summarize({ running: 0, waiting: 1, suggestions: 3 }), '1 thing needs your OK');
  assert.equal(summarize({ running: 0, waiting: 0, suggestions: 3 }), '3 suggestions to review');
  assert.equal(summarize({ running: 0, waiting: 0, suggestions: 0, checked_at: new Date(Date.now() - 5 * 60e3).toISOString() }), 'Up to date · checked 5 min ago');
  assert.equal(summarize({ running: 0, waiting: 0, suggestions: 0, checked_at: null }), 'Up to date');
});
