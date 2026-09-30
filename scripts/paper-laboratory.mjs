// Usage: node scripts/paper-laboratory.mjs frames.json output.json
// Offline read-only evidence replay. Output contains independent portfolios and restart state.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PaperStrategyLaboratory } from '../dist/src/paper-laboratory.js';
const [input, output] = process.argv.slice(2);
if (!input || !output || resolve(input) === resolve(output) || resolve(output) === resolve('runs/paper/state.json')) throw new Error('Supply distinct evidence input and laboratory output; primary account is forbidden');
const frames = JSON.parse(await readFile(input, 'utf8'));
let saved;
try { saved = JSON.parse(await readFile(output, 'utf8')).state; } catch (e) { if (e.code !== 'ENOENT') throw e; }
const laboratory = new PaperStrategyLaboratory(Date.parse(frames[0]?.completedAt ?? new Date().toISOString()), saved);
for (const frame of frames) if (frame.sequence > laboratory.state.sequence) await laboratory.consume(frame);
await writeFile(output, JSON.stringify({ state: laboratory.state, metrics: laboratory.metrics() }, null, 2), { mode: 0o600 });
console.log(JSON.stringify(laboratory.metrics(), null, 2));
