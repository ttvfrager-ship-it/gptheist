// Restart only the identified paper desk; preserve its environment and account.
import { readFile, readlink, copyFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const pid = Number(process.argv[2]);
const cwd = await readlink(`/proc/${pid}/cwd`);
const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
if (cwd !== process.cwd() || args.join(' ') !== 'node dist/src/cli.js desk') throw new Error('Unexpected process; refusing restart');
const env = Object.fromEntries((await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0').filter(Boolean).map(s => {const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
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
