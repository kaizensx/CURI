// The user's projects: folders Claude Code already knows plus folders added in CURI. For each one we
// read which ecosystem and package manager it uses, so "add this library" runs the right command in the
// right place (npm/pnpm/yarn/bun, uv/pip, Swift Package Manager is assisted) and is verified afterwards.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { claudeJsonPath } from './paths.mjs';
import { getPref, setPref } from './db.mjs';
import { which } from './platform.mjs';

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const has = (dir, f) => fs.existsSync(path.join(dir, f));

export function describeProject(dir) {
  const out = { path: dir, name: path.basename(dir), exists: fs.existsSync(dir), ecosystems: [] };
  if (!out.exists) return out;
  if (has(dir, 'package.json')) {
    const pm = has(dir, 'pnpm-lock.yaml') ? 'pnpm' : has(dir, 'yarn.lock') ? 'yarn' : has(dir, 'bun.lockb') || has(dir, 'bun.lock') ? 'bun' : 'npm';
    out.ecosystems.push({ id: 'js', manager: pm, available: Boolean(which(pm)) });
    out.package_name = readJson(path.join(dir, 'package.json'))?.name || null;
  }
  if (has(dir, 'pyproject.toml') || has(dir, 'requirements.txt')) {
    const uv = has(dir, 'uv.lock') || (has(dir, 'pyproject.toml') && which('uv'));
    out.ecosystems.push({ id: 'py', manager: uv ? 'uv' : 'pip', available: uv ? Boolean(which('uv')) : has(dir, '.venv') });
  }
  if (has(dir, 'Package.swift')) out.ecosystems.push({ id: 'swift', manager: 'swiftpm', available: false });
  return out;
}

export function listProjects(db) {
  const known = Object.keys(readJson(claudeJsonPath())?.projects || {});
  const mine = getPref(db, 'projects', []);
  const hidden = new Set(getPref(db, 'projects_hidden', []));
  return [...new Set([...mine, ...known])].filter(p => !hidden.has(p) && p !== os.homedir()).map(describeProject).filter(p => p.exists);
}

export function addProject(db, dir) {
  const p = path.resolve(String(dir || '').replace(/^~(?=$|\/)/, os.homedir()));
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error('Essa pasta não existe.');
  const list = getPref(db, 'projects', []);
  if (!list.includes(p)) setPref(db, 'projects', [p, ...list].slice(0, 50));
  setPref(db, 'projects_hidden', getPref(db, 'projects_hidden', []).filter(x => x !== p));
  return describeProject(p);
}
export function hideProject(db, dir) {
  setPref(db, 'projects', getPref(db, 'projects', []).filter(x => x !== dir));
  setPref(db, 'projects_hidden', [...new Set([...getPref(db, 'projects_hidden', []), dir])]);
}

// From a documented project command ("npm install gsap", "pip install librosa", "npx shadcn@latest add @x/y")
// to the argv that fits this project. Returns null when it cannot be run unattended.
export function planProjectCommand(command, project, { component } = {}) {
  const parts = command.trim().split(/\s+/);
  const js = project.ecosystems.find(e => e.id === 'js'), py = project.ecosystems.find(e => e.id === 'py');
  if (parts[0] === 'npx' && parts.includes('shadcn@latest') && parts.includes('add')) {
    if (!js) return { error: 'O projeto não é JavaScript (falta package.json).' };
    const target = parts.at(-1).replace('<componente>', component || '');
    if (!component && /<componente>/.test(parts.at(-1))) return { needs: 'component' };
    return { cmd: 'npx', args: ['--yes', 'shadcn@latest', 'add', target, '--yes'], verify: null, ecosystem: 'js' };
  }
  if (parts[0] === 'npx' || parts[0] === 'npm' && parts[1] === 'init') return { error: 'Este comando cria um projeto novo; corra-o numa pasta vazia.' };
  if (parts[0] === 'npm' && /^(i|install|add)$/.test(parts[1])) {
    if (!js) return { error: 'O projeto não é JavaScript (falta package.json).' };
    const dev = parts.includes('-D') || parts.includes('--save-dev');
    const pkgs = parts.slice(2).filter(x => !x.startsWith('-') && x !== '&&' && x !== 'npm' && x !== 'install');
    const pm = js.manager;
    const args = pm === 'npm' ? ['install', ...(dev ? ['-D'] : []), ...pkgs] : pm === 'yarn' ? ['add', ...(dev ? ['-D'] : []), ...pkgs] : ['add', ...(dev ? ['-D'] : []), ...pkgs];
    return { cmd: pm, args, verify: { js: pkgs.map(x => x.replace(/(.)@[^@/]*$/, '$1')) }, ecosystem: 'js' };
  }
  if (parts[0] === 'pip' && parts[1] === 'install') {
    if (!py) return { error: 'O projeto não é Python (falta pyproject.toml ou requirements.txt).' };
    const pkgs = parts.slice(2).map(x => x.replace(/^"|"$/g, ''));
    if (py.manager === 'uv') return { cmd: 'uv', args: ['add', ...pkgs], verify: { py: pkgs.map(x => x.replace(/\[.*$/, '')) }, ecosystem: 'py' };
    if (fs.existsSync(path.join(project.path, '.venv'))) return { cmd: path.join(project.path, '.venv', os.platform() === 'win32' ? 'Scripts' : 'bin', 'pip'), args: ['install', ...pkgs], verify: { py: pkgs.map(x => x.replace(/\[.*$/, '')) }, ecosystem: 'py' };
    return { error: 'O projeto não tem ambiente virtual (.venv) nem uv; crie um primeiro.' };
  }
  return { error: 'Este passo faz-se à mão (copie o comando).' };
}

export function verifyInProject(project, verify) {
  if (verify?.js) {
    const pj = readJson(path.join(project.path, 'package.json')) || {};
    const deps = { ...pj.dependencies, ...pj.devDependencies };
    return verify.js.every(n => n in deps);
  }
  if (verify?.py) {
    const t = [path.join(project.path, 'pyproject.toml'), path.join(project.path, 'requirements.txt')].map(f => { try { return fs.readFileSync(f, 'utf8').toLowerCase(); } catch { return ''; } }).join('\n');
    return verify.py.every(n => t.includes(n.toLowerCase())) || null;
  }
  return null;
}
