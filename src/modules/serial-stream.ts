import { SerialPort } from 'bun-serialport';
import { BAUD_RATE, SERIAL_REOPEN_MS } from 'consts';
import { EventEmitter } from 'node:events'
import type { SerialState } from 'types';

/**
 * The WT61's serial port, kept open: a failed open, a read error or an unplug
 * closes it, and it is reopened every `reopenMs` until it works again.
 * Opening the port does not reset the module — it streams from power-up.
 */
export class SerialStream {
  private port;
  event = new EventEmitter<{
    'data:stream': [Uint8Array];
    state: [SerialState, string | undefined];
  }>();
  state: SerialState = 'closed';
  /** why the port is closed, while it is */
  lastError?: string;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    readonly device: string,
    readonly baudRate = BAUD_RATE,
    private readonly reopenMs = SERIAL_REOPEN_MS,
  ) {
    const port = new SerialPort({
      path: this.device,
      baudRate: this.baudRate,
      autoOpen: false
    })

    this.listener = this.listener.bind(this);

    this.port = port;
    this.port.on('data', this.listener);
    // an 'error' without a listener would throw out of the read loop
    this.port.on('error', (err) => this.lost(err.message));
    this.port.on('close', () => this.lost(this.lastError ?? 'port closed'));
  }

  start() {
    this.stopped = false;
    void this.open();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    if (this.port.isOpen) await this.port.close().catch(() => {});
  }

  private async open() {
    this.retry = undefined;
    if (this.stopped) return;
    try {
      await this.port.open();
      this.lastError = undefined;
      this.setState('open');
    } catch (err) {
      this.lost(err instanceof Error ? err.message : String(err));
    }
  }

  private lost(reason: string) {
    if (this.stopped) return;
    const changed = this.state !== 'closed' || this.lastError !== reason;
    this.lastError = reason;
    if (changed) this.setState('closed', reason);
    this.retry ??= setTimeout(() => void this.open(), this.reopenMs);
  }

  private setState(state: SerialState, reason?: string) {
    this.state = state;
    if (state === 'open') console.log(`serial ${this.device} open at ${this.baudRate} baud`);
    else console.warn(`serial ${this.device} closed: ${reason} — retrying every ${this.reopenMs} ms`);
    this.event.emit('state', state, reason);
  }

  private listener(data: Uint8Array) {
    this.event.emit('data:stream', data);
  }
}
