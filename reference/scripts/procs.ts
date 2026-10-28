/**
 * Processes and memory for the multi-session tools. A process is "inside" a worktree if its `cwd` hangs from it: that
 * is how agent sessions, dev servers and test runners are recognised. System reads never throw: without `lsof`, `ps`
 * or `sysctl` they return empty, and nobody is left without a session because of a failed probe.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { basename, sep } from 'node:path';
import { config } from './dev-flow.config.ts';

export interface Proc {
  pid: number;
  ppid: number;
  /** Executable name (`node`, `claude`, `next-server`…). */
  command: string;
  args: string;
  /** Resident memory in KB. */
  rssKb: number;
  cwd?: string;
}

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // lsof exits 1 if some process cannot be read, but the output for the others is valid
    return String((e as { stdout?: unknown }).stdout ?? '');
  }
}

/** `ps -axo pid=,ppid=,rss=,args=` → processes without `cwd`. */
export function parsePs(out: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const args = (m[4] ?? '').trim();
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), args, command: basename(args.split(/\s+/)[0] ?? '') });
  }
  return procs;
}

/** `lsof -d cwd -Fpn` → pid → cwd. */
export function parseLsofCwd(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

function linuxCwds(): Map<number, string> {
  const cwds = new Map<number, string>();
  let entries: string[] = [];
  try {
    entries = readdirSync('/proc');
  } catch {
    return cwds;
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    try {
      cwds.set(Number(name), readlinkSync(`/proc/${name}/cwd`));
    } catch {
      // someone else's process, or already gone
    }
  }
  return cwds;
}

/** Every process on the system with its `cwd`, in a single read (one `ps` call and one `lsof` call). */
export function listProcesses(): Proc[] {
  const procs = parsePs(run('ps', ['-axo', 'pid=,ppid=,rss=,args=']));
  const cwds = process.platform === 'linux' ? linuxCwds() : parseLsofCwd(run('lsof', ['-d', 'cwd', '-Fpn']));
  for (const p of procs) p.cwd = cwds.get(p.pid);
  return procs.filter((p) => p.pid !== process.pid);
}

export function isInside(dir: string, path: string | undefined): boolean {
  return !!path && (path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep));
}

export function processesIn(procs: Proc[], dir: string): Proc[] {
  return procs.filter((p) => isInside(dir, p.cwd));
}

const AGENT_ARGS = new RegExp(config.agentProcess.argsPattern);
const DEV_TOOL_COMMAND = new RegExp(`^(${config.devToolPattern})$`);
const DEV_TOOL_ARGS = new RegExp(`\\b(${config.devToolArgsPattern})\\b`);

/** An agent session: it is never stopped (rule: never close a session without permission). */
export function isAgent(p: Pick<Proc, 'command' | 'args'>): boolean {
  return p.command === config.agentProcess.command || AGENT_ARGS.test(p.args);
}

/** Dev-tool processes that `wt reap` may stop when they are orphaned. */
export function isDevTool(p: Pick<Proc, 'command' | 'args'>): boolean {
  if (isAgent(p)) return false;
  return DEV_TOOL_COMMAND.test(p.command) || DEV_TOOL_ARGS.test(p.args.split(/\s+/).slice(0, 3).join(' '));
}

export const formatMb = (kb: number) => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** SIGTERM; SIGKILL for those still alive after `graceMs`. Never an agent process. Returns the stopped ones. */
export async function stopProcesses(procs: Proc[], graceMs = 5000): Promise<Proc[]> {
  const targets = procs.filter((p) => !isAgent(p) && p.pid !== process.pid);
  for (const p of targets) {
    try {
      process.kill(p.pid, 'SIGTERM');
    } catch {
      // it had already finished
    }
  }
  const deadline = Date.now() + graceMs;
  while (targets.some((p) => alive(p.pid)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  for (const p of targets.filter((t) => alive(t.pid))) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      // it finished between the check and the signal
    }
  }
  return targets;
}

export type Pressure = 'normal' | 'warn' | 'critical';

export interface MemoryInfo {
  pressure?: Pressure;
  /** Percentage of swap used (0–100); `undefined` if there is no swap or it could not be read. */
  swapPct?: number;
  /** The biggest consumers, with memory as the system counts it (compressed memory included on macOS). */
  top: { pid: number; command: string; kb: number }[];
  fseventsdKb?: number;
  /** Spotlight (`mds_stores`): with many new files it has been seen at 103 GB. */
  mdsStoresKb?: number;
}

/** `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warn, 4 critical. */
export function parsePressureLevel(out: string): Pressure | undefined {
  const level = Number(out.trim());
  return level === 4 ? 'critical' : level === 2 ? 'warn' : level === 1 ? 'normal' : undefined;
}

const UNITS: Record<string, number> = { B: 1 / 1024, K: 1, M: 1024, G: 1024 * 1024, T: 1024 * 1024 * 1024 };

/** `vm.swapusage`: "total = 15360.00M  used = 14500.00M  free = …". */
export function parseSwapUsage(out: string): number | undefined {
  const total = /total = ([\d.]+)M/.exec(out)?.[1];
  const used = /used = ([\d.]+)M/.exec(out)?.[1];
  if (!total || !used || Number(total) === 0) return undefined;
  return Math.round((Number(used) / Number(total)) * 100);
}

/** `top -l 1 -o mem -stats pid,mem,command`: the MEM column carries a suffix (`23G`, `511M`, `1467M+`). */
export function parseTopMem(out: string): { pid: number; command: string; kb: number }[] {
  const rows: { pid: number; command: string; kb: number }[] = [];
  let inTable = false;
  for (const line of out.split('\n')) {
    if (/^\s*PID\s+MEM\s+COMMAND/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const m = /^\s*(\d+)\s+([\d.]+)([BKMGT])[+-]?\s+(.+?)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), kb: Math.round(Number(m[2]) * (UNITS[m[3] ?? 'K'] ?? 1)), command: m[4] ?? '' });
  }
  return rows;
}

/** `/proc/meminfo`: pressure from `MemAvailable` (< 10 % critical, < 20 % warn) and swap. */
export function parseMeminfo(out: string): Pick<MemoryInfo, 'pressure' | 'swapPct'> {
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(out)?.[1] ?? Number.NaN);
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  const swapTotal = kb('SwapTotal');
  const swapFree = kb('SwapFree');
  const ratio = available / total;
  return {
    pressure: Number.isFinite(ratio) ? (ratio < 0.1 ? 'critical' : ratio < 0.2 ? 'warn' : 'normal') : undefined,
    swapPct: swapTotal > 0 ? Math.round(((swapTotal - swapFree) / swapTotal) * 100) : undefined,
  };
}

/** System memory state. Never throws: whatever cannot be read stays `undefined`. */
export function memoryInfo(): MemoryInfo {
  try {
    if (process.platform === 'darwin') {
      const top = parseTopMem(run('top', ['-l', '1', '-o', 'mem', '-stats', 'pid,mem,command']));
      return {
        pressure: parsePressureLevel(run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])),
        swapPct: parseSwapUsage(run('sysctl', ['-n', 'vm.swapusage'])),
        top: top.slice(0, 3),
        fseventsdKb: top.find((r) => r.command.startsWith('fseventsd'))?.kb,
        mdsStoresKb: top.find((r) => r.command.startsWith('mds_stores'))?.kb,
      };
    }
    if (process.platform === 'linux') {
      const procs = parsePs(run('ps', ['-axo', 'pid=,ppid=,rss=,args=']))
        .sort((a, b) => b.rssKb - a.rssKb)
        .slice(0, 3);
      return { ...parseMeminfo(readFileSync('/proc/meminfo', 'utf8')), top: procs.map((p) => ({ pid: p.pid, command: p.command, kb: p.rssKb })) };
    }
  } catch {
    // no memory data: the warning is simply not shown
  }
  return { top: [] };
}
