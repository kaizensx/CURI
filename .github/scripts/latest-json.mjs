// Writes the update manifest installed copies of CURI read (Tauri updater format) from the signed
// files in the current folder. Usage: node latest-json.mjs <version> <download base URL> <CHANGELOG.md>
import fs from 'node:fs';

const [version, base, changelog] = process.argv.slice(2);
if (!version || !base) throw new Error('usage: latest-json.mjs <version> <base url> [CHANGELOG.md]');

// This version's CHANGELOG section becomes the "What's new" text in the app.
let notes = '';
if (changelog && fs.existsSync(changelog)) {
  const lines = fs.readFileSync(changelog, 'utf8').split('\n');
  const start = lines.findIndex(l => l.startsWith(`## ${version} `));
  if (start >= 0) {
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    notes = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  }
}

const files = fs.readdirSync('.');
const entry = rx => {
  const file = files.find(f => rx.test(f) && files.includes(`${f}.sig`));
  return file ? { signature: fs.readFileSync(`${file}.sig`, 'utf8').trim(), url: `${base}/${file}` } : null;
};

const mac = entry(/_universal\.app\.tar\.gz$/);
const platforms = {
  'darwin-aarch64': mac,
  'darwin-x86_64': mac,
  'windows-x86_64': entry(/_x64-setup\.exe$/),
  'linux-x86_64': entry(/_amd64\.AppImage$/),
};
for (const [k, v] of Object.entries(platforms)) if (!v) delete platforms[k];
if (!Object.keys(platforms).length) throw new Error('no signed update files found');

process.stdout.write(JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2) + '\n');
