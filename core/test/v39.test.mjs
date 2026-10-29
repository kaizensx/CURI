import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sandbox } from './helpers.mjs';

sandbox('v39');
const { openDb } = await import('../src/db.mjs');
const { importSeeds, syncCuratedCapabilities } = await import('../src/registry.mjs');
const { ACTIONS } = await import('../src/api.mjs');
const { checkUpdates } = await import('../src/updates.mjs');
const { describeOp } = await import('../../app/lib/optext.js');

test('every kit member is a catalogue resource from the starter seeds', () => {
  const db = openDb();
  importSeeds(db);
  const ids = new Set(db.prepare('SELECT id FROM resources').all().map(r => r.id));
  for (const k of ACTIONS.kits()) {
    assert.ok(k.resources.length >= 3, `${k.id} has at least three members`);
    for (const id of k.resources) assert.ok(ids.has(id), `${k.id}: ${id} is in the catalogue`);
  }
});

test('curated capability links reach an existing registry without re-importing', () => {
  const db = openDb();
  importSeeds(db);
  db.prepare("DELETE FROM resource_capabilities WHERE capability_id='web-search'").run();
  assert.ok(syncCuratedCapabilities(db) >= 1);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM resource_capabilities WHERE capability_id='web-search'").get().n >= 1);
  assert.equal(syncCuratedCapabilities(db), 0, 'a second pass adds nothing');
});

test('update check with nothing CURI installed finds nothing and remembers when it looked', async () => {
  const db = openDb();
  const r = await checkUpdates(db);
  assert.deepEqual(r.items, []);
  assert.ok(ACTIONS.updates(db).checked_at);
});

test('activity reads as sentences, by status', () => {
  const op = (kind, status, params = {}) => describeOp({ kind, status, params, actor: 'agent' }).title;
  assert.equal(op('plugin.install', 'verified', { plugin: 'taste-skill@taste-skill' }), 'Installed taste-skill in Claude Code');
  assert.equal(op('plugin.update', 'failed', { plugin: 'caveman@caveman' }), "Couldn't update caveman in Claude Code");
  assert.equal(op('discover', 'running', { mode: 'task', intent: 'noodle' }), 'Search GitHub for "noodle"…');
  assert.equal(describeOp({ kind: 'system.scan', status: 'verified', params: {}, actor: 'user-approved' }).who, 'You');
});
