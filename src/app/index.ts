import '../playground/style.css'
import shellHtml from './shell.html?raw'

type BemergedMountTarget = string | HTMLElement

export type BemergedAppMountOptions = {
  host?: BemergedMountTarget
}

let bemergedBootstrapPromise: Promise<unknown> | null = null

function resolveBemergedHost(host?: BemergedMountTarget): HTMLElement {
  if (typeof host === 'string') {
    const element = document.querySelector(host)
    if (!(element instanceof HTMLElement)) {
      throw new Error(`BeMerged host element not found for selector: ${host}`)
    }
    return element
  }

  if (host instanceof HTMLElement) {
    return host
  }

  return document.body
}

function renderBemergedShell(host: HTMLElement): void {
  const template = document.createElement('template')
  template.innerHTML = shellHtml.trim()
  host.replaceChildren(template.content.cloneNode(true))
}

export async function mountBemergedApp(options: BemergedAppMountOptions = {}): Promise<void> {
  if (typeof document === 'undefined') return

  const host = resolveBemergedHost(options.host)
  document.body.classList.add('bemerged-loading')
  renderBemergedShell(host)

  if (!bemergedBootstrapPromise) {
    bemergedBootstrapPromise = import('../playground/main')
  }

  await bemergedBootstrapPromise
}

export { shellHtml as bemergedShellHtml }
