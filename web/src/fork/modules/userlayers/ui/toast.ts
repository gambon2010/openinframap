// Fork: the hint at the bottom of the map while a tool is in use ("Click the map
// to put a marker there"), with a Stop button.
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import type { Workspace } from './workspace.ts'

export class Toast {
  readonly el = el('.oim-ul-toast', { role: 'status' })
  private ws: Workspace

  constructor(ws: Workspace) {
    this.ws = ws
  }

  update() {
    const tools = this.ws.tools
    const tool = tools.tool
    let text = tools.message
    if (tool.mode === 'graphic' && tool.points.length) {
      text += ' ' + t('userlayers.points-so-far', '({{n}} so far)', { n: tool.points.length })
    }
    const active = tool.mode !== 'select' && Boolean(text)
    this.el.textContent = ''
    if (active) {
      const stop = el('button', t('userlayers.stop', 'Stop (Esc)'), { type: 'button' })
      stop.onclick = () => tools.setTool({ mode: 'select' })
      this.el.append(el('span', text), stop)
    }
    this.el.classList.toggle('visible', active)
  }
}
