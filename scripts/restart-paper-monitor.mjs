// Restart only the identified paper desk; preserve its environment and account.
import { readFile, readlink, realpath, copyFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const pid = Number(process.argv[2]);
const cwd = await readlink(`/proc/${pid}/cwd`);
const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
if (cwd !== process.cwd() || args.slice(1).join(' ') !== 'dist/src/cli.js desk' ||
    await readlink(`/proc/${pid}/exe`) !== await realpath(process.execPath)) throw new Error('Unexpected process; refusing restart');
const env = Object.fromEntries((await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0').filter(Boolean).map(s => {const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const refreshIndex = process.argv.indexOf('--quote-refresh-ms');
if (refreshIndex >= 0) {
  const refresh = Number(process.argv[refreshIndex + 1]);
  if (!Number.isFinite(refresh) || refresh < 1000) throw new Error('--quote-refresh-ms must be at least 1000');
  env.PAPER_QUOTE_REFRESH_MS = String(refresh);
}
const strategyIndex = process.argv.indexOf('--strategy-mode');
if (strategyIndex >= 0) {
  const mode = process.argv[strategyIndex + 1];
  if (!['STRICT', 'SCALP'].includes(mode)) throw new Error('--strategy-mode must be STRICT or SCALP');
  env.PAPER_STRATEGY_MODE = mode;
}
const discoveryIndex = process.argv.indexOf('--discovery-interval-ms');
if (discoveryIndex >= 0) {
  const interval = Number(process.argv[discoveryIndex + 1]);
  if (!Number.isFinite(interval) || interval < 1000) throw new Error('--discovery-interval-ms must be at least 1000');
  env.PAPER_DISCOVERY_INTERVAL_MS = String(interval);
}
process.kill(pid, 'SIGTERM');
let stopped = false;
for(let i=0;i<120;i++) {
  try { process.kill(pid,0); } catch(e) { if(e.code==='ESRCH'){stopped=true;break;} throw e; }
  await new Promise(resolve=>setTimeout(resolve,500));
}
if(!stopped) throw new Error('Original server has not stopped; refusing a second writer');
const backup=`runs/paper/monitor-fix-backup-${Date.now()}.json`;
await copyFile('runs/paper/state.json',backup);
const log=await open('runs/paper-monitor.log','a',0o600);
const child=spawn(process.execPath,args.slice(1),{cwd,env,detached:true,stdio:['ignore',log.fd,log.fd]});
child.unref();await log.close();
console.log(JSON.stringify({pid:child.pid,backup,log:'runs/paper-monitor.log'}));
