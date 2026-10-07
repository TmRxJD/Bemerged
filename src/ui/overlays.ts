type HoverCardInput = {
  anchorX: number
  anchorY: number
  title: string
  subtitle?: string
  lines: string[]
  accent?: string
}

const HOVER_CARD_ID = 'bemerged-hover-card'
const SNACKBAR_ID = 'bemerged-snackbar'

let snackbarTimer: number | null = null

function getHoverCardEl(): HTMLDivElement | null {
  const el = document.getElementById(HOVER_CARD_ID)
  return el instanceof HTMLDivElement ? el : null
}

function getSnackbarEl(): HTMLDivElement | null {
  const el = document.getElementById(SNACKBAR_ID)
  return el instanceof HTMLDivElement ? el : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function hideBemergedHoverCard(): void {
  const el = getHoverCardEl()
  if (!el) return
  el.className = 'bemerged-hover-card hidden'
  el.replaceChildren()
}

export function showBemergedHoverCard(input: HoverCardInput): void {
  const el = getHoverCardEl()
  if (!el) return

  const titleEl = document.createElement('div')
  titleEl.className = 'bemerged-hover-card__title'
  titleEl.textContent = input.title

  const children: Node[] = [titleEl]

  if (input.subtitle) {
    const subtitleEl = document.createElement('div')
    subtitleEl.className = 'bemerged-hover-card__subtitle'
    subtitleEl.textContent = input.subtitle
    children.push(subtitleEl)
  }

  for (const line of input.lines) {
    const lineEl = document.createElement('div')
    lineEl.className = 'bemerged-hover-card__line'
    lineEl.textContent = line
    children.push(lineEl)
  }

  el.replaceChildren(...children)
  el.className = `bemerged-hover-card bemerged-hover-card--${String(input.accent || 'default').trim() || 'default'}`
  el.style.left = '0px'
  el.style.top = '0px'
  el.classList.remove('hidden')

  const rect = el.getBoundingClientRect()
  const left = clamp(input.anchorX + 14, 10, window.innerWidth - rect.width - 10)
  const top = clamp(input.anchorY + 16, 10, window.innerHeight - rect.height - 10)
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

export function showBemergedSnackbar(message: string, timeoutMs = 3200): void {
  const el = getSnackbarEl()
  if (!el) return

  if (snackbarTimer !== null) {
    window.clearTimeout(snackbarTimer)
    snackbarTimer = null
  }

  el.textContent = message
  el.classList.remove('hidden')
  el.classList.add('bemerged-snackbar--visible')

  snackbarTimer = window.setTimeout(() => {
    el.classList.add('hidden')
    el.classList.remove('bemerged-snackbar--visible')
    snackbarTimer = null
  }, Math.max(1200, Math.floor(Number(timeoutMs) || 3200)))
}
