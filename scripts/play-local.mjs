import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const siblingAiEntryPath = path.resolve(repoRoot, '..', 'BemergedAI', 'src', 'index.ts')
const installedAiPackagePath = path.resolve(repoRoot, 'node_modules', '@tmrxjd', 'bemerged-ai', 'package.json')
const cliArgs = process.argv.slice(2)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runCommand(command, args) {
  return await new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += String(chunk || '')
    })

    child.stderr.on('data', chunk => {
      stderr += String(chunk || '')
    })

    child.on('error', error => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() })
    })

    child.on('close', code => {
      resolve({ code: Number(code) || 0, stdout, stderr })
    })
  })
}

async function listListeningPids(port) {
  const targetPort = Math.max(1, Math.floor(Number(port) || 0))
  if (!targetPort) return []

  if (process.platform === 'win32') {
    const psScript = [
      `$conns = Get-NetTCPConnection -State Listen -LocalPort ${targetPort} -ErrorAction SilentlyContinue`,
      'if ($conns) { $conns | Select-Object -ExpandProperty OwningProcess -Unique }',
    ].join('; ')

    const result = await runCommand('powershell', ['-NoProfile', '-Command', psScript])
    if (result.code !== 0) return []
    return String(result.stdout || '')
      .split(/\r?\n/)
      .map(line => Number(line.trim()))
      .filter(pid => Number.isFinite(pid) && pid > 0 && pid !== process.pid)
  }

  const result = await runCommand('lsof', ['-ti', `tcp:${targetPort}`, '-sTCP:LISTEN'])
  if (result.code !== 0) return []
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map(line => Number(line.trim()))
    .filter(pid => Number.isFinite(pid) && pid > 0 && pid !== process.pid)
}

async function killPid(pid) {
  const targetPid = Number(pid)
  if (!Number.isFinite(targetPid) || targetPid <= 0 || targetPid === process.pid) return

  if (process.platform === 'win32') {
    await runCommand('taskkill', ['/PID', String(targetPid), '/T', '/F'])
    return
  }

  try {
    process.kill(targetPid, 'SIGTERM')
  } catch {
    void 0
  }
}

async function killPortListeners(port) {
  const pids = await listListeningPids(port)
  if (pids.length === 0) return

  console.log(`[bemerged] Restarting localhost dev server on port ${port}; stopping pid(s): ${pids.join(', ')}`)
  for (const pid of pids) {
    await killPid(pid)
  }

  await sleep(350)
}

function ensureArg(args, flag, value) {
  if (args.includes(flag)) return args
  return [...args, flag, value]
}

if (existsSync(siblingAiEntryPath)) {
  console.log('[bemerged] Optional AI Play addon detected from sibling BemergedAI repo.')
} else if (existsSync(installedAiPackagePath)) {
  console.log('[bemerged] Optional AI Play addon detected from installed @tmrxjd/bemerged-ai package.')
} else {
  console.log('[bemerged] Starting game-only local host. Scripted autoplay is available; AI Play is disabled.')
}

const viteArgs = ensureArg(ensureArg([...cliArgs], '--host', 'localhost'), '--port', '5179')
if (!viteArgs.includes('--strictPort')) {
  viteArgs.push('--strictPort')
}
const portIndex = viteArgs.findIndex(arg => arg === '--port')
const targetPort = portIndex >= 0 ? Number(viteArgs[portIndex + 1]) || 5179 : 5179
await killPortListeners(targetPort)
const command = process.platform === 'win32'
  ? `pnpm exec vite ${viteArgs.join(' ')}`.trim()
  : 'pnpm'
const child = process.platform === 'win32'
  ? spawn(command, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  })
  : spawn(command, ['exec', 'vite', ...viteArgs], {
  cwd: repoRoot,
  stdio: 'inherit',
})

child.on('exit', code => {
  process.exit(code ?? 0)
})
