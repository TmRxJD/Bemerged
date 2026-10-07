import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const port = 4173
const host = '127.0.0.1'
const startupTimeoutMs = 45000
const pollIntervalMs = 750

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
    })
    return
  }

  child.kill('SIGTERM')
}

async function waitForServer(url) {
  const startedAt = Date.now()
  let lastError = null

  while ((Date.now() - startedAt) < startupTimeoutMs) {
    try {
      const response = await fetch(url)
      const html = await response.text()
      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`)
      }
      if (!html.includes('<title>Bemerged</title>')) {
        throw new Error('Missing Bemerged local host title in response')
      }
      if (!html.includes('id="bemerged-site-host"')) {
        throw new Error('Missing Bemerged site host in response HTML')
      }
      if (!html.includes('/src/app/entry.ts')) {
        throw new Error('Missing Bemerged app entry in response HTML')
      }
      return
    } catch (error) {
      lastError = error
      await sleep(pollIntervalMs)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Timed out waiting for Bemerged local host')
}

async function main() {
  const command = process.platform === 'win32'
    ? 'node scripts/play-local.mjs --host 127.0.0.1 --port 4173 --strictPort --clearScreen false'
    : 'node'

  const child = process.platform === 'win32'
    ? spawn(command, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: true,
    })
    : spawn(command, ['scripts/play-local.mjs', '--host', host, '--port', String(port), '--strictPort', '--clearScreen', 'false'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })

  try {
    await waitForServer(`http://${host}:${port}/`)
    console.log('[bemerged] Local host smoke test passed.')
  } finally {
    await stopChild(child)
  }
}

main().catch(error => {
  console.error('[bemerged] Local host smoke test failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})