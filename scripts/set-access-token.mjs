#!/usr/bin/env node
/**
 * Set or clear the JARVIS access token.
 *   node scripts/set-access-token.mjs            # generate random
 *   node scripts/set-access-token.mjs <token>    # set explicit
 *   node scripts/set-access-token.mjs --clear    # disable auth
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const CONFIG_DIR = join(homedir(), '.jarvis');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

mkdirSync(CONFIG_DIR, { recursive: true });

let cfg = {};
if (existsSync(CONFIG_FILE)) {
  try { cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')); } catch {}
}

const arg = process.argv[2];
if (arg === '--clear') {
  delete cfg.accessToken;
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  console.log('✓ Access token cleared. JARVIS will accept any connection.');
  process.exit(0);
}

let token;
if (arg) {
  if (arg.length < 12) {
    console.error('✗ Token must be at least 12 chars.');
    process.exit(1);
  }
  token = arg;
} else {
  token = randomBytes(24).toString('hex');
}

cfg.accessToken = token;
writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));

console.log('');
console.log('✓ JARVIS access token set:');
console.log('');
console.log(`    ${token}`);
console.log('');
console.log('Save this — you\'ll need it on every device that connects remotely.');
console.log('Restart JARVIS for it to take effect: cd ~/Projects/jarvis && npm run dev');
console.log('');
