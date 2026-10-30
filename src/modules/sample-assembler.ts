import type { PacketType, Vec3, Wt61Packet, Wt61Sample } from 'types'

const ACCEL = 0x51
const GYRO = 0x52
const ANGLE = 0x53

/**
 * WT61 spec §7.2. Each is a power-of-two fraction, so count × scale is exact
 * in a double and a consumer can recover the count.
 */
export const ACCEL_G_PER_COUNT = 16 / 32768
export const GYRO_DPS_PER_COUNT = 2000 / 32768
export const ANGLE_DEG_PER_COUNT = 180 / 32768

/** T = count / 340 + 36.53 °C (the spec's text; its sample code says 36.25). */
export function temperatureC(count: number): number {
  return Math.round((count / 340 + 36.53) * 100) / 100
}

type Words = Wt61Packet['words']

type Cycle = {
  seq: number;
  last: PacketType;
  accel?: Words;
  gyro?: Words;
  angle?: Words;
}

/**
 * Groups the module's packets into samples. It sends acceleration, angular
 * velocity and angle in that order, once per cycle (100 Hz at 115200 baud).
 *
 * A packet whose type is not later than the last one seen starts a new cycle,
 * so a cycle still counts when its acceleration packet was the one lost.
 * Every cycle takes a `seq`; one that is not complete when its angle packet
 * arrives (or never gets one) is dropped and counted, leaving a gap in `seq`.
 */
export class SampleAssembler {
  seq = 0
  samples = 0
  incompleteCycles = 0
  private cycle: Cycle | null = null

  push(packet: Wt61Packet, readAtMs: number): Wt61Sample | null {
    if (this.cycle === null || packet.type <= this.cycle.last) {
      if (this.cycle !== null) this.incompleteCycles++
      this.cycle = { seq: ++this.seq, last: packet.type }
    }
    const c = this.cycle
    c.last = packet.type
    if (packet.type === ACCEL) c.accel = packet.words
    else if (packet.type === GYRO) c.gyro = packet.words
    else c.angle = packet.words
    if (packet.type !== ANGLE) return null

    this.cycle = null
    if (c.accel === undefined || c.gyro === undefined || c.angle === undefined) {
      this.incompleteCycles++
      return null
    }
    this.samples++
    return {
      seq: c.seq,
      readAtMs,
      accelG: scaled(c.accel, ACCEL_G_PER_COUNT),
      gyroDps: scaled(c.gyro, GYRO_DPS_PER_COUNT),
      angleDeg: scaled(c.angle, ANGLE_DEG_PER_COUNT),
      temperatureC: temperatureC(c.accel[3]),
    }
  }

  /** Drop a partial cycle — the port was reopened. `seq` keeps counting. */
  reset() {
    if (this.cycle !== null) this.incompleteCycles++
    this.cycle = null
  }
}

function scaled(words: Words, perCount: number): Vec3 {
  return { x: words[0] * perCount, y: words[1] * perCount, z: words[2] * perCount }
}
