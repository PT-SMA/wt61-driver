import { describe, expect, test } from 'bun:test'
import { encodePacket, SampleAssembler, temperatureC, Wt61Decoder } from 'modules'
import type { Wt61Packet } from 'types'

// WT61 spec §7.2, 0x51: 55 51 AxL AxH AyL AyH AzL AzH TL TH Sum
const SPEC_ACCEL = new Uint8Array([0x55, 0x51, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x18, 0xfc, 0x00])
SPEC_ACCEL[10] = SPEC_ACCEL.subarray(0, 10).reduce((a, b) => a + b, 0) & 0xff

describe('Wt61Decoder', () => {
  test('a spec-built packet: little-endian words, checksum = low byte of the sum', () => {
    const d = new Wt61Decoder()
    expect(d.push(SPEC_ACCEL)).toEqual([{ type: 0x51, words: [0, 0, 2048, -1000] }])
    expect(encodePacket(0x51, [0, 0, 2048, -1000])).toEqual(SPEC_ACCEL)
  })

  test('sign extension at both ends of int16', () => {
    const [p] = new Wt61Decoder().push(encodePacket(0x52, [32767, -32768, -1, 1]))
    expect(p!.words).toEqual([32767, -32768, -1, 1])
  })

  test('a packet cut across any chunk boundary', () => {
    const bytes = encodePacket(0x53, [100, -200, 300, -400])
    for (let cut = 1; cut < bytes.length; cut++) {
      const d = new Wt61Decoder()
      expect(d.push(bytes.subarray(0, cut))).toEqual([])
      expect(d.push(bytes.subarray(cut))).toEqual([{ type: 0x53, words: [100, -200, 300, -400] }])
      expect(d.droppedBytes).toBe(0)
    }
  })

  test('garbage, and a 0x55 that is not a header, are skipped and counted', () => {
    const d = new Wt61Decoder()
    const out = d.push(new Uint8Array([0x00, 0x55, 0x99, 0x55, ...encodePacket(0x51, [1, 2, 3, 4])]))
    expect(out.map((p) => p.words)).toEqual([[1, 2, 3, 4]])
    expect(d.droppedBytes).toBe(4)
    expect(d.checksumErrors).toBe(0)
  })

  test('a bad checksum skips only its header, so the next packet is still found', () => {
    const bad = encodePacket(0x52, [1, 2, 3, 4])
    bad[10] = (bad[10]! + 1) & 0xff
    const d = new Wt61Decoder()
    const out = d.push(new Uint8Array([...bad, ...encodePacket(0x53, [5, 6, 7, 8])]))
    expect(out).toEqual([{ type: 0x53, words: [5, 6, 7, 8] }])
    expect(d.checksumErrors).toBe(1)
    expect(d.droppedBytes).toBe(11)
  })

  test('reset drops a partial packet', () => {
    const d = new Wt61Decoder()
    d.push(encodePacket(0x51, [1, 2, 3, 4]).subarray(0, 5))
    d.reset()
    expect(d.push(encodePacket(0x52, [5, 6, 7, 8]))).toEqual([{ type: 0x52, words: [5, 6, 7, 8] }])
  })
})

const p = (type: 0x51 | 0x52 | 0x53, words: Wt61Packet['words'] = [0, 0, 0, 0]): Wt61Packet => ({ type, words })

describe('SampleAssembler', () => {
  test('scales per the spec: 16 g, 2000 °/s, 180° full scale, exactly', () => {
    const a = new SampleAssembler()
    a.push(p(0x51, [2048, -1024, 32767, 0]), 1)
    a.push(p(0x52, [16384, -16384, 1, 0]), 1)
    const s = a.push(p(0x53, [16384, -32768, 1, 0]), 7)!
    expect(s.seq).toBe(1)
    expect(s.readAtMs).toBe(7)
    expect(s.accelG).toEqual({ x: 1, y: -0.5, z: 15.99951171875 })
    expect(s.gyroDps).toEqual({ x: 1000, y: -1000, z: 2000 / 32768 })
    expect(s.angleDeg).toEqual({ x: 90, y: -180, z: 180 / 32768 })
    // exact: the raw count comes back
    expect(s.accelG.z * 32768 / 16).toBe(32767)
  })

  test('temperature = count / 340 + 36.53 °C, from the acceleration packet', () => {
    expect(temperatureC(0)).toBe(36.53)
    expect(temperatureC(-1000)).toBe(33.59)
    expect(temperatureC(3400)).toBe(46.53)
  })

  test('a corrupt angular-velocity packet: the cycle is dropped and seq skips', () => {
    const a = new SampleAssembler()
    const seqs: number[] = []
    const feed = (...packets: Wt61Packet[]) => {
      for (const packet of packets) {
        const s = a.push(packet, 0)
        if (s) seqs.push(s.seq)
      }
    }
    feed(p(0x51), p(0x52), p(0x53))
    feed(p(0x51), /* 0x52 lost */ p(0x53))
    feed(p(0x51), p(0x52), p(0x53))
    expect(seqs).toEqual([1, 3])
    expect(a.incompleteCycles).toBe(1)
    expect(a.samples).toBe(2)
  })

  test('a lost acceleration packet still counts as a cycle', () => {
    const a = new SampleAssembler()
    const seqs: number[] = []
    for (const packet of [p(0x51), p(0x52), p(0x53), p(0x52), p(0x53), p(0x51), p(0x52), p(0x53)]) {
      const s = a.push(packet, 0)
      if (s) seqs.push(s.seq)
    }
    expect(seqs).toEqual([1, 3])
  })

  test('a lost angle packet: the next acceleration closes the cycle as incomplete', () => {
    const a = new SampleAssembler()
    const seqs: number[] = []
    for (const packet of [p(0x51), p(0x52), /* 0x53 lost */ p(0x51), p(0x52), p(0x53)]) {
      const s = a.push(packet, 0)
      if (s) seqs.push(s.seq)
    }
    expect(seqs).toEqual([2])
    expect(a.incompleteCycles).toBe(1)
  })

  test('reset drops a partial cycle; seq keeps counting', () => {
    const a = new SampleAssembler()
    a.push(p(0x51), 0)
    a.reset()
    a.push(p(0x51), 0)
    a.push(p(0x52), 0)
    expect(a.push(p(0x53), 0)!.seq).toBe(2)
    expect(a.incompleteCycles).toBe(1)
  })
})
