import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { encodePacket, Outbox, Wt61Driver, type ByteSource } from 'modules'
import type { SerialState } from 'types'
import { collect } from './_fixture'

class FakeSource implements ByteSource {
  readonly device = '/dev/fake'
  readonly baudRate = 115200
  state: SerialState = 'open'
  lastError?: string
  event = new EventEmitter<{ 'data:stream': [Uint8Array]; state: [SerialState, string | undefined] }>()
  started = false
  start() {
    this.started = true
  }
  async stop() {}
  set(state: SerialState, error?: string) {
    this.state = state
    this.lastError = error
    this.event.emit('state', state, error)
  }
}

const cycle = (z: number) =>
  new Uint8Array([
    ...encodePacket(0x51, [0, 0, z, 0]),
    ...encodePacket(0x52, [0, 0, 0, 0]),
    ...encodePacket(0x53, [0, 0, 0, 0]),
  ])

const types = (text: string) => text.trim().split('\n').map((l) => JSON.parse(l).type)

let driver: Wt61Driver | undefined
afterEach(async () => {
  await driver?.stop()
  driver = undefined
})

function startDriver(source: FakeSource) {
  driver = new Wt61Driver({
    source,
    hostname: '127.0.0.1',
    port: 0,
    driverVersion: 'test',
    statusIntervalMs: null,
  })
  driver.start()
  return driver
}

describe('the TCP side', () => {
  test('every client gets hello and status first, then the same samples', async () => {
    const source = new FakeSource()
    const d = startDriver(source)
    expect(source.started).toBe(true)
    const a = await collect(d.server.port)
    const b = await collect(d.server.port)
    await a.lines(2)
    await b.lines(2)
    source.event.emit('data:stream', cycle(2048))
    await a.lines(3)
    await b.lines(3)
    expect(types(a.text())).toEqual(['hello', 'status', 'sample'])
    expect(a.text().split('\n')[2]).toBe(b.text().split('\n')[2]!)
    a.close()
    b.close()
  })

  test('what a client sends is ignored', async () => {
    const source = new FakeSource()
    const d = startDriver(source)
    const a = await collect(d.server.port)
    await a.lines(2)
    a.socket.write('{"type":"command"}\n')
    source.event.emit('data:stream', cycle(2048))
    await a.lines(3)
    expect(types(a.text())).toEqual(['hello', 'status', 'sample'])
    a.close()
  })

  test('the serial port closing and reopening goes out at once as status', async () => {
    const source = new FakeSource()
    const d = startDriver(source)
    const a = await collect(d.server.port)
    await a.lines(2)
    source.set('closed', 'ENOENT')
    source.set('open')
    await a.lines(4)
    const [, , closed, open] = a.text().trim().split('\n').map((l) => JSON.parse(l))
    expect(closed).toMatchObject({ type: 'status', serial: 'closed', error: 'ENOENT' })
    expect(open).toMatchObject({ type: 'status', serial: 'open' })
    expect(open.error).toBeUndefined()
    a.close()
  })

  test('a client connecting while the port is closed is told so in hello', async () => {
    const source = new FakeSource()
    source.state = 'closed'
    source.lastError = 'No such file or directory'
    const d = startDriver(source)
    const a = await collect(d.server.port)
    await a.lines(2)
    const [hello, status] = a.text().trim().split('\n').map((l) => JSON.parse(l))
    expect(hello).toMatchObject({ type: 'hello', version: 1, serial: 'closed', device: '/dev/fake' })
    expect(status).toMatchObject({ serial: 'closed', error: 'No such file or directory' })
    a.close()
  })
})

describe('Outbox', () => {
  const bytes = (n: number) => new Uint8Array(n)

  test('a socket that takes everything queues nothing', () => {
    const o = new Outbox((b) => b.length, 100)
    expect(o.send(bytes(50))).toBe('ok')
    expect(o.backlogBytes).toBe(0)
  })

  test('a partial write keeps the rest, in order, for drain', () => {
    const written: number[] = []
    let room = 3
    const o = new Outbox((b) => {
      const n = Math.min(room, b.length)
      room -= n
      written.push(...b.subarray(0, n))
      return n
    }, 100)
    expect(o.send(new Uint8Array([1, 2, 3, 4, 5]))).toBe('ok')
    expect(o.send(new Uint8Array([6, 7]))).toBe('ok')
    expect(o.backlogBytes).toBe(4)
    room = 100
    expect(o.flush()).toBe(true)
    expect(written).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(o.backlogBytes).toBe(0)
  })

  test('a client too far behind is reported, never silently trimmed', () => {
    const o = new Outbox(() => 0, 100)
    expect(o.send(bytes(60))).toBe('ok')
    expect(o.send(bytes(60))).toBe('behind')
  })

  test('a closed socket is reported', () => {
    expect(new Outbox(() => -1, 100).send(bytes(1))).toBe('closed')
  })
})
