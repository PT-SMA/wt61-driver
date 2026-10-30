import { STATUS_INTERVAL_MS } from 'consts'
import type { EventEmitter } from 'node:events'
import type { DriverCounters, SerialState } from 'types'
import { helloLine, sampleLine, statusLine } from './protocol'
import { SampleAssembler } from './sample-assembler'
import { LineServer } from './tcp-server'
import { Wt61Decoder } from './wt61-decoder'

/** What the driver needs from the serial side (a `SerialStream`, or a fake). */
export interface ByteSource {
  readonly device: string;
  readonly baudRate: number;
  readonly state: SerialState;
  readonly lastError?: string;
  event: EventEmitter<{
    'data:stream': [Uint8Array];
    state: [SerialState, string | undefined];
  }>;
  start(): void;
  stop(): Promise<void>;
}

export type DriverOptions = {
  source: ByteSource;
  hostname: string;
  port: number;
  driverVersion: string;
  now?: () => number;
  /** null: no status timer (tests call `status()`) */
  statusIntervalMs?: number | null;
  maxBacklogBytes?: number;
}

/** Serial bytes → packets → samples → NDJSON lines to every TCP client. */
export class Wt61Driver {
  readonly startedAtMs: number
  readonly server: LineServer
  private decoder = new Wt61Decoder()
  private assembler = new SampleAssembler()
  private now: () => number
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly options: DriverOptions) {
    this.now = options.now ?? Date.now
    this.startedAtMs = this.now()
    this.server = new LineServer({
      hostname: options.hostname,
      port: options.port,
      greeting: () => [this.hello(), this.status()],
      maxBacklogBytes: options.maxBacklogBytes,
    })
    this.onBytes = this.onBytes.bind(this)
    this.onState = this.onState.bind(this)
  }

  start() {
    this.server.start()
    const { source } = this.options
    source.event.on('data:stream', this.onBytes)
    source.event.on('state', this.onState)
    source.start()
    const every = this.options.statusIntervalMs === undefined
      ? STATUS_INTERVAL_MS
      : this.options.statusIntervalMs
    if (every !== null) {
      this.timer = setInterval(() => this.server.broadcast(this.status()), every)
    }
    console.log(
      `wt61-driver ${this.options.driverVersion} on ${this.options.hostname}:${this.server.port}` +
        ` ← ${source.device} @ ${source.baudRate}`,
    )
  }

  async stop() {
    clearInterval(this.timer)
    this.options.source.event.off('data:stream', this.onBytes)
    this.options.source.event.off('state', this.onState)
    await this.options.source.stop()
    this.server.stop()
  }

  /** A sample's `readAt` is when the chunk that completed it was read. */
  onBytes(chunk: Uint8Array) {
    const packets = this.decoder.push(chunk)
    if (packets.length === 0) return
    const readAtMs = this.now()
    for (const packet of packets) {
      const sample = this.assembler.push(packet, readAtMs)
      if (sample !== null) this.server.broadcast(sampleLine(sample))
    }
  }

  counters(): DriverCounters {
    return {
      samples: this.assembler.samples,
      checksumErrors: this.decoder.checksumErrors,
      incompleteCycles: this.assembler.incompleteCycles,
      droppedBytes: this.decoder.droppedBytes,
    }
  }

  hello(): string {
    const { source } = this.options
    return helloLine({
      driverVersion: this.options.driverVersion,
      device: source.device,
      baudRate: source.baudRate,
      serial: source.state,
      startedAtMs: this.startedAtMs,
    })
  }

  status(): string {
    const { source } = this.options
    return statusLine({
      atMs: this.now(),
      serial: source.state,
      error: source.lastError,
      counters: this.counters(),
    })
  }

  private onState(state: SerialState) {
    if (state === 'open') {
      this.decoder.reset()
      this.assembler.reset()
    }
    this.server.broadcast(this.status())
  }
}
