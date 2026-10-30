import type { Socket, TCPSocketListener } from 'bun'
import { MAX_CLIENT_BACKLOG_BYTES } from 'consts'

/**
 * What one client has not taken yet. Bun's `socket.write` does not buffer: it
 * returns how much the kernel took, so the rest waits here for `drain`. Lines
 * are never split or skipped — a client is cut off instead, once it is more
 * than `maxBacklogBytes` behind.
 */
export class Outbox {
  backlogBytes = 0
  private queue: Uint8Array[] = []

  constructor(
    private readonly write: (bytes: Uint8Array) => number,
    private readonly maxBacklogBytes = MAX_CLIENT_BACKLOG_BYTES,
  ) {}

  /** Anything but `ok`: drop this client. */
  send(bytes: Uint8Array): 'ok' | 'closed' | 'behind' {
    if (this.queue.length === 0) {
      const n = this.write(bytes)
      if (n < 0) return 'closed'
      if (n === bytes.length) return 'ok'
      bytes = bytes.subarray(n)
    }
    this.queue.push(bytes)
    this.backlogBytes += bytes.length
    return this.backlogBytes <= this.maxBacklogBytes ? 'ok' : 'behind'
  }

  /** The socket can take more. false: it closed. */
  flush(): boolean {
    while (this.queue.length > 0) {
      const head = this.queue[0]!
      const n = this.write(head)
      if (n < 0) return false
      this.backlogBytes -= n
      if (n < head.length) {
        this.queue[0] = head.subarray(n)
        return true
      }
      this.queue.shift()
    }
    return true
  }
}

type Client = { outbox: Outbox; remote: string }

export type LineServerOptions = {
  hostname: string;
  port: number;
  /** the first lines a new client gets (hello, status) */
  greeting: () => string[];
  maxBacklogBytes?: number;
}

/**
 * Pushes lines to every connected client. One-way: what a client sends is
 * ignored (reserved for commands in a later protocol version).
 */
export class LineServer {
  private clients = new Set<Socket<Client>>()
  private listener?: TCPSocketListener<Client>
  private encoder = new TextEncoder()

  constructor(private readonly options: LineServerOptions) {}

  /** The bound port (the real one when started on port 0). */
  get port(): number {
    return this.listener?.port ?? this.options.port
  }

  get clientCount(): number {
    return this.clients.size
  }

  start() {
    const self = this
    const cap = this.options.maxBacklogBytes ?? MAX_CLIENT_BACKLOG_BYTES
    this.listener = Bun.listen<Client>({
      hostname: this.options.hostname,
      port: this.options.port,
      socket: {
        open(socket) {
          socket.data = {
            outbox: new Outbox((bytes) => socket.write(bytes), cap),
            remote: `${socket.remoteAddress}`,
          }
          self.clients.add(socket)
          console.log(`client ${socket.data.remote} connected (${self.clients.size} now)`)
          for (const line of self.options.greeting()) self.sendTo(socket, self.encoder.encode(line))
        },
        data() {},
        drain(socket) {
          if (!socket.data.outbox.flush()) self.drop(socket, 'closed')
        },
        close(socket) {
          if (self.clients.delete(socket)) {
            console.log(`client ${socket.data.remote} disconnected (${self.clients.size} now)`)
          }
        },
        error(socket, error) {
          console.error(`client ${socket.data?.remote}: ${error.message}`)
          self.clients.delete(socket)
        },
      },
    })
  }

  broadcast(line: string) {
    if (this.clients.size === 0) return
    const bytes = this.encoder.encode(line)
    for (const socket of this.clients) this.sendTo(socket, bytes)
  }

  stop() {
    this.listener?.stop(true)
    this.clients.clear()
  }

  private sendTo(socket: Socket<Client>, bytes: Uint8Array) {
    const sent = socket.data.outbox.send(bytes)
    if (sent === 'closed') this.drop(socket, 'closed')
    else if (sent === 'behind') {
      this.drop(socket, `${socket.data.outbox.backlogBytes} bytes behind`)
    }
  }

  private drop(socket: Socket<Client>, why: string) {
    if (!this.clients.delete(socket)) return
    console.warn(`client ${socket.data.remote} dropped: ${why}`)
    socket.terminate()
  }
}
