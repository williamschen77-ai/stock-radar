import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webDir = resolve(import.meta.dirname, '..');
const envPath = resolve(import.meta.dirname, '../.env');
const envValues = existsSync(envPath)
  ? Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }))
  : {};
const apiOrigin = process.env.STOCK_RADAR_API_ORIGIN || envValues.STOCK_RADAR_API_ORIGIN;

if (!apiOrigin || !/^https:\/\//.test(apiOrigin)) {
  console.error('Set STOCK_RADAR_API_ORIGIN to your public HTTPS domain before building the mobile app.');
  process.exit(1);
}

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(command, ['run', 'build'], {
  cwd: webDir,
  env: { ...process.env, CAPACITOR_BUILD: 'true', VITE_API_ORIGIN: apiOrigin.replace(/\/$/, '') },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
