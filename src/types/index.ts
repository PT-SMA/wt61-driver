export type DriverConfig = {
  DEVICES: string[];
  HOST: string;
  PORT: number;
  BAUD_RATE: number;
}

export type Vec3 = { x: number; y: number; z: number }

export type PacketType = 0x51 | 0x52 | 0x53

/** One checksum-valid 11-byte packet: 0x55, type, four int16 LE, sum. */
export type Wt61Packet = {
  type: PacketType;
  /** sign-extended: x, y, z, temperature */
  words: [number, number, number, number];
}

/** One full cycle: the acceleration, angular velocity and angle packets. */
export type Wt61Sample = {
  /** the driver's cycle counter; skipped numbers are cycles lost on serial */
  seq: number;
  readAtMs: number;
  accelG: Vec3;
  gyroDps: Vec3;
  /** the module's Kalman attitude: x roll, y pitch, z yaw (integrated) */
  angleDeg: Vec3;
  temperatureC: number;
}

export type SerialState = 'open' | 'closed'

/** Since the driver started. */
export type DriverCounters = {
  samples: number;
  checksumErrors: number;
  incompleteCycles: number;
  droppedBytes: number;
}
