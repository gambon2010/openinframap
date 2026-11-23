// Fork: live updates from the backend (web-backend/src/fork/userdata/events.py,
// Server-Sent Events): one connection per page, opened by the first listener. The
// browser reconnects by itself after a disconnection, and the backend then says
// what was missed. Kinds: "changes" (My layers you can see were saved), "access"
// (what you can see changed).
export type LiveKind = 'changes' | 'access'

const listeners = new Map<LiveKind, (() => void)[]>()
let source: EventSource | undefined
let connectedBefore = false

/** Call `listener` when something of that kind happens (a burst: once). */
export function onLive(kind: LiveKind, listener: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = () => {
    clearTimeout(timer)
    timer = setTimeout(listener, 300)
  }
  listeners.set(kind, [...(listeners.get(kind) ?? []), debounced])
  connect()
}

function emit(kind: LiveKind) {
  for (const listener of listeners.get(kind) ?? []) listener()
}

function connect() {
  if (source || typeof EventSource === 'undefined') return
  source = new EventSource('/userdata/events')
  for (const kind of ['changes', 'access'] as LiveKind[]) {
    source.addEventListener(kind, () => emit(kind))
  }
  // Connected again after a break: what you can see may have changed meanwhile.
  source.addEventListener('ready', () => {
    if (connectedBefore) emit('access')
    connectedBefore = true
  })
}
