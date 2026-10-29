// System notifications. Inside the desktop app the shell shows them (on every OS); from the terminal or
// the background service on macOS, Notification Center via osascript; elsewhere they're skipped.
import { spawn } from 'node:child_process';

export function notifyUser(title, body = '') {
  title = String(title).slice(0, 120); body = String(body).slice(0, 300);
  if (process.env.CURI_SHELL) { process.stdout.write(`CURI-NOTIFY ${JSON.stringify({ title, body })}\n`); return true; }
  if (process.platform !== 'darwin') return false;
  const q = s => s.replace(/["\\]/g, '');
  spawn('osascript', ['-e', `display notification "${q(body)}" with title "${q(title)}"`], { stdio: 'ignore' }).on('error', () => {});
  return true;
}
