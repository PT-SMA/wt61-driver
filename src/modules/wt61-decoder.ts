import type { PacketType, Wt61Packet } from 'types'

const HEADER = 0x55
const PACKET_BYTES = 11
const TYPES: ReadonlySet<number> = new Set([0x51, 0x52, 0x53])

/**
 * WitMotion's serial packets out of a byte stream (WT61 spec §7.2): 0x55, a
 * type (0x51 acceleration, 0x52 angular velocity, 0x53 angle), four int16
 * little-endian words, and a checksum — the low byte of the sum of the first
 * ten bytes.
 *
 * Chunks arrive cut anywhere, so a partial packet waits for the next push. A
 * byte that cannot start a valid packet is skipped and counted; a bad checksum
 * skips only its 0x55, so a real packet inside the damage is still found.
 */
export class Wt61Decoder {
  checksumErrors = 0
  droppedBytes = 0
  private rest = new Uint8Array(0)

  push(chunk: Uint8Array): Wt61Packet[] {
    const buf = this.rest.length === 0 ? chunk : concat(this.rest, chunk)
    const packets: Wt61Packet[] = []
    let i = 0
    while (i < buf.length) {
      if (buf[i] !== HEADER) {
        this.drop(1)
        i++
        continue
      }
      if (i + 1 >= buf.length) break
      if (!TYPES.has(buf[i + 1]!)) {
        this.drop(1)
        i++
        continue
      }
      if (buf.length - i < PACKET_BYTES) break
      let sum = 0
      for (let k = 0; k < PACKET_BYTES - 1; k++) sum += buf[i + k]!
      if ((sum & 0xff) !== buf[i + PACKET_BYTES - 1]) {
        this.checksumErrors++
        this.drop(1)
        i++
        continue
      }
      const view = new DataView(buf.buffer, buf.byteOffset + i, PACKET_BYTES)
      packets.push({
        type: buf[i + 1] as PacketType,
        words: [
          view.getInt16(2, true),
          view.getInt16(4, true),
          view.getInt16(6, true),
          view.getInt16(8, true),
        ],
      })
      i += PACKET_BYTES
    }
    this.rest = buf.slice(i)
    return packets
  }

  /** Forget a partial packet — the port was reopened. */
  reset() {
    this.rest = new Uint8Array(0)
  }

  private drop(n: number) {
    this.droppedBytes += n
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** One packet as the module sends it — fixtures and tests. */
export function encodePacket(type: PacketType, words: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(PACKET_BYTES)
  const view = new DataView(out.buffer)
  out[0] = HEADER
  out[1] = type
  words.forEach((w, k) => view.setInt16(2 + 2 * k, w, true))
  let sum = 0
  for (let k = 0; k < PACKET_BYTES - 1; k++) sum += out[k]!
  out[PACKET_BYTES - 1] = sum & 0xff
  return out
}
