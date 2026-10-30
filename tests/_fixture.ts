import { EventEmitter } from 'node:events'
import { encodePacket, Wt61Driver, type ByteSource } from 'modules'
import type { PacketType, SerialState } from 'types'

/**
 * The contract fixture: raw serial bytes (tests/fixtures/wt61-stream-v1.bin)
 * and the exact lines the driver must send for them (…-v1.ndjson).
 * microservice.hm keeps a byte-identical copy of the .ndjson and checks its
 * parser against it — regenerate with `bun run fixture`, then copy it over.
 */
export const FIXTURE_BIN = new URL('./fixtures/wt61-stream-v1.bin', import.meta.url).pathname
export const FIXTURE_NDJSON = new URL('./fixtures/wt61-stream-v1.ndjson', import.meta.url).pathname

/** Fixed, so the fixture does not change with the package version. */
export const FIXTURE_DRIVER_VERSION = '0.1.0'
export const FIXTURE_DEVICE = '/dev/ttyUSB0'
/** 2026-10-29T06:00:00.000Z; the clock moves 10 ms per reading */
export const FIXTURE_T0 = Date.UTC(2026, 9, 29, 6, 0, 0)
/** Odd on purpose: packets arrive cut across chunks. */
export const FIXTURE_CHUNK_BYTES = 7

type Words = [number, number, number, number]
const ACCEL = 0x51, GYRO = 0x52, ANGLE = 0x53

const packet = (type: PacketType, words: Words) => [...encodePacket(type, words)]
const corrupt = (bytes: number[]) => {
  bytes[10] = (bytes[10]! + 1) & 0xff
  return bytes
}

/**
 * seq 1 at rest, flat · 2 negatives · 3 bad gyro checksum (dropped) ·
 * 4 full scale · 5 acceleration packet lost (dropped) · 6 pulling away
 * while turning left. Garbage first, including a 0x55 that is not a header.
 */
export function fixtureBytes(): Uint8Array {
  return new Uint8Array([
    0x00, 0xff, 0x55, 0x00, 0x12, 0x55,
    ...packet(ACCEL, [0, 0, 2048, -1000]),
    ...packet(GYRO, [0, 0, 0, -1000]),
    ...packet(ANGLE, [0, 0, 0, -1000]),
    ...packet(ACCEL, [-123, 456, 2040, -990]),
    ...packet(GYRO, [-16, 33, -1, -990]),
    ...packet(ANGLE, [-182, 91, 32767, -990]),
    ...packet(ACCEL, [10, 20, 2047, -985]),
    ...corrupt(packet(GYRO, [1, 2, 3, -985])),
    ...packet(ANGLE, [4, 5, 6, -985]),
    ...packet(ACCEL, [32767, -32768, 2048, -980]),
    ...packet(GYRO, [32767, -32768, 0, -980]),
    ...packet(ANGLE, [-32768, 16384, -16384, -980]),
    ...packet(GYRO, [0, 0, 7, -975]),
    ...packet(ANGLE, [0, 0, 1, -975]),
    ...packet(ACCEL, [205, 0, 2048, -970]),
    ...packet(GYRO, [0, 0, 98, -970]),
    ...packet(ANGLE, [1, -2, 3, -970]),
  ])
}

class FixtureSource implements ByteSource {
  readonly device = FIXTURE_DEVICE
  readonly baudRate = 115200
  state: SerialState = 'open'
  lastError?: string
  event = new EventEmitter<{ 'data:stream': [Uint8Array]; state: [SerialState, string | undefined] }>()
  start() {}
  async stop() {}
}

/**
 * Runs the real driver over `bytes` and returns everything one TCP client
 * received: hello, status, the samples, and a closing status.
 */
export async function driverOutput(bytes: Uint8Array): Promise<string> {
  let t = FIXTURE_T0 - 10
  const source = new FixtureSource()
  const driver = new Wt61Driver({
    source,
    hostname: '127.0.0.1',
    port: 0,
    driverVersion: FIXTURE_DRIVER_VERSION,
    now: () => (t += 10),
    statusIntervalMs: null,
  })
  driver.start()
  const client = await collect(driver.server.port)
  await client.lines(2)
  for (let i = 0; i < bytes.length; i += FIXTURE_CHUNK_BYTES) {
    source.event.emit('data:stream', bytes.subarray(i, i + FIXTURE_CHUNK_BYTES))
  }
  driver.server.broadcast(driver.status())
  const statuses = (text: string) => text.split('\n').filter((l) => l.includes('"type":"status"')).length
  await client.until((text) => statuses(text) === 2)
  client.close()
  await driver.stop()
  return client.text()
}

/** A plain TCP client that keeps every byte it receives. */
export async function collect(port: number) {
  let text = ''
  const decoder = new TextDecoder()
  const waiters: (() => void)[] = []
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port,
    socket: {
      data(_socket, data) {
        text += decoder.decode(data, { stream: true })
        for (const w of waiters.splice(0)) w()
      },
    },
  })
  const until = async (done: (text: string) => boolean, timeoutMs = 2000) => {
    const deadline = Date.now() + timeoutMs
    while (!done(text)) {
      if (Date.now() > deadline) throw new Error(`timed out; got:\n${text}`)
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
        setTimeout(resolve, 20)
      })
    }
  }
  return {
    socket,
    text: () => text,
    lines: (n: number) => until((t) => t.split('\n').length - 1 >= n),
    until,
    close: () => socket.end(),
  }
}
