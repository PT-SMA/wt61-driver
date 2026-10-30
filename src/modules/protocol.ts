import type { DriverCounters, SerialState, Wt61Sample } from 'types'

/**
 * The wire to microservice.hm: one JSON object per `\n` line. The contract is
 * FMS-Backend/docs/ecosystem/integrations/wt61-driver-to-hm.md, pinned by
 * tests/fixtures/wt61-stream-v1.ndjson (microservice.hm checks the same file).
 * This is the only place a line is written — change the contract, the
 * fixture and microservice.hm together.
 *
 * Adding a field is not breaking (consumers ignore unknown fields and types);
 * renaming, removing or re-meaning one bumps PROTOCOL_VERSION.
 */
export const PROTOCOL_VERSION = 1
export const DRIVER_NAME = 'wt61-driver'

export type HelloInfo = {
  driverVersion: string;
  device: string;
  baudRate: number;
  serial: SerialState;
  startedAtMs: number;
}

export type StatusInfo = {
  atMs: number;
  serial: SerialState;
  /** why the serial port is closed */
  error?: string;
  counters: DriverCounters;
}

/** First line on every connection. */
export function helloLine(info: HelloInfo): string {
  return line({
    type: 'hello',
    version: PROTOCOL_VERSION,
    driver: DRIVER_NAME,
    driverVersion: info.driverVersion,
    device: info.device,
    baudRate: info.baudRate,
    serial: info.serial,
    startedAt: iso(info.startedAtMs),
  })
}

export function sampleLine(sample: Wt61Sample): string {
  return line({
    type: 'sample',
    seq: sample.seq,
    readAt: iso(sample.readAtMs),
    accelG: sample.accelG,
    gyroDps: sample.gyroDps,
    angleDeg: sample.angleDeg,
    temperatureC: sample.temperatureC,
  })
}

/** Every second, and at once when the serial port opens or closes. */
export function statusLine(status: StatusInfo): string {
  return line({
    type: 'status',
    at: iso(status.atMs),
    serial: status.serial,
    ...(status.serial === 'closed' && status.error !== undefined ? { error: status.error } : {}),
    ...status.counters,
  })
}

function line(value: Record<string, unknown>): string {
  return JSON.stringify(value) + '\n'
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}
