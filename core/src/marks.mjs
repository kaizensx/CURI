// Personal layer over the catalogue: favourites, own collections, notes, hidden items, and per-resource
// overrides (kind, extra project command). Nothing in the catalogue is fixed for the user.
import { getPref, setPref } from './db.mjs';
import { audit } from './audit-log.mjs';
import { KIND } from './profile.mjs';

export const allMarks = db => getPref(db, 'user_marks', {});
export const marksFor = (db, id) => allMarks(db)[id] || {};

export function setMark(db, id, patch) {
  if (!db.prepare('SELECT 1 FROM resources WHERE id=?').get(id)) throw new Error('Recurso inexistente.');
  const all = allMarks(db);
  const cur = { ...(all[id] || {}) };
  if ('fav' in patch) cur.fav = Boolean(patch.fav);
  if ('hidden' in patch) cur.hidden = Boolean(patch.hidden);
  if ('notes' in patch) cur.notes = String(patch.notes || '').slice(0, 4000);
  if ('collections' in patch) cur.collections = [...new Set((patch.collections || []).map(c => String(c).trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
  if ('kind' in patch) { if (patch.kind && !KIND[patch.kind]) throw new Error('Tipo inválido.'); cur.kind = patch.kind || null; }
  if ('command' in patch) {
    const c = String(patch.command || '').trim();
    if (c && !/^(npm (i|install|add)|pnpm add|yarn add|bun add|pip install|uv add|npx shadcn@latest add) [\w@./<>=\[\]"-]+( [\w@./<>=\[\]"-]+)*$/.test(c)) throw new Error('Comando não suportado: use npm/pnpm/yarn/bun add, pip install, uv add ou npx shadcn@latest add.');
    cur.command = c || null;
  }
  for (const k of Object.keys(cur)) if (cur[k] == null || cur[k] === false || cur[k] === '' || (Array.isArray(cur[k]) && !cur[k].length)) delete cur[k];
  if (Object.keys(cur).length) all[id] = cur; else delete all[id];
  setPref(db, 'user_marks', all);
  audit(db, 'user', 'resource.personalise', id, { fields: Object.keys(patch) });
  return cur;
}

export function collections(db) {
  const counts = {};
  for (const m of Object.values(allMarks(db))) for (const c of m.collections || []) counts[c] = (counts[c] || 0) + 1;
  for (const c of getPref(db, 'collections', [])) counts[c] ??= 0;
  return Object.entries(counts).map(([name, n]) => ({ name, n })).sort((a, b) => a.name.localeCompare(b.name));
}
export function addCollection(db, name) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) throw new Error('Nome vazio.');
  setPref(db, 'collections', [...new Set([...getPref(db, 'collections', []), n])]);
  return collections(db);
}
export function removeCollection(db, name) {
  setPref(db, 'collections', getPref(db, 'collections', []).filter(c => c !== name));
  const all = allMarks(db);
  for (const m of Object.values(all)) if (m.collections) m.collections = m.collections.filter(c => c !== name);
  setPref(db, 'user_marks', all);
  return collections(db);
}
