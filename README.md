# wt61-driver

Reads a WitMotion **WT61** IMU (WT61C-TTL) over serial, decodes its packets, and serves
them as NDJSON over TCP. Its consumer is **microservice.hm**, which uses the module as the
IMU with `HOUR_METER_IMU_SOURCE=wit` (`WT61_URL`, default `tcp://127.0.0.1:6699`): for the
travel direction, `hour-meter:imu`, and roll/pitch on `hour-meter:update`.

```bash
bun install
bun run start          # or: bun run index.ts
bun test               # hermetic: no device, no network beyond 127.0.0.1
bun check              # type check
```

Run `bun fmt` to format the code. Watch the stream: `socat - TCP:127.0.0.1:6699` (or
`nc 127.0.0.1 6699`).

## Debian package

```bash
bun run package:deb          # dist/wt61-driver_<version>_{amd64,arm64}.deb
bun run package:deb arm64    # one architecture
bun run build                # just the binary for this machine: dist/wt61-driver
```

`scripts/build-deb.ts` compiles a standalone binary (`bun build --compile`; amd64 uses
Bun's baseline build, which needs no AVX2) and writes the `.deb` itself, so it needs GNU
tar but not dpkg. The version comes from `package.json`. The package installs:

| Path | |
|---|---|
| `/usr/bin/wt61-driver` | the binary; needs only glibc ≥ 2.17 |
| `/usr/lib/systemd/system/wt61-driver.service` | `packaging/wt61-driver.service` |
| `/etc/default/wt61.conf` | the binary's config, from `etc/configs/config.sample.conf`; a conffile, so upgrades keep your edits |

The service is installed but not enabled or started:

```bash
sudo apt install ./wt61-driver_0.1.0_amd64.deb
sudoedit /etc/default/wt61.conf
sudo systemctl enable --now wt61-driver
journalctl -u wt61-driver -f
```

The service runs as a transient user (`DynamicUser=yes`) in the `dialout` group, which can
open `/dev/ttyUSB*`. An upgrade restarts the service if it is running. `apt remove` stops
and disables it, and `apt purge` also deletes the config. The maintainer scripts live in
`packaging/debian/`.

## Configuration

The first of:

1. `--config <file>`, which must exist;
2. the compiled binary (`bun run build`, the .deb): `/etc/default/wt61.conf`;
3. `bun run` (development only): `etc/configs/config.conf` in the working directory —
   copy `etc/configs/config.sample.conf`. The binary never reads it.

Without the file the driver runs on the defaults and says so.

| Key | Default | Meaning |
|---|---|---|
| `DEVICES` | `/dev/ttyUSB0` | serial devices, comma-separated; only the first is read. `/dev/serial/by-id/…` survives re-enumeration |
| `BAUD_RATE` | `115200` | the module's rate: 115200 streams 100 Hz (factory default), 9600 only 20 Hz |
| `HOST` | `127.0.0.1` | where to listen; `0.0.0.0` only for a consumer without host networking |
| `PORT` | `6699` | |

A failed open, a read error or an unplug closes the serial port; it is reopened every 2 s.
Clients stay connected meanwhile and are told (`status` with `serial: "closed"`).

## The contract with microservice.hm

`FMS-Backend/docs/ecosystem/integrations/wt61-driver-to-hm.md` — protocol version 1:

```jsonc
{"type":"hello","version":1,"driver":"wt61-driver","driverVersion":"0.1.0","device":"/dev/ttyUSB0","baudRate":115200,"serial":"open","startedAt":"…"}
{"type":"sample","seq":1,"readAt":"…","accelG":{"x":0,"y":0,"z":1},"gyroDps":{"x":0,"y":0,"z":0},"angleDeg":{"x":0,"y":0,"z":0},"temperatureC":33.59}
{"type":"status","at":"…","serial":"open","samples":4,"checksumErrors":1,"incompleteCycles":2,"droppedBytes":17}
```

`hello` first on every connection, a `sample` per WT61 cycle (~100 Hz; a gap in `seq` is
cycles lost on serial), `status` every second and on each serial change. One-way: client
input is ignored. A client more than 256 KB behind is disconnected.

It is pinned by `tests/fixtures/wt61-stream-v1.bin` (serial bytes) →
`wt61-stream-v1.ndjson` (exactly what the driver sends for them; `tests/contract.test.ts`
checks it through a real TCP client). microservice.hm keeps a byte-identical copy of the
`.ndjson` and parses it in its own tests (`deno task wt61:verify` compares the two).

To change the wire: edit `src/modules/protocol.ts`, `bun run fixture`, review the diff,
update the contract doc, copy the `.ndjson` to
`microservice.hm/tests/fixtures/wt61/stream-v1.ndjson`, and update microservice.hm's
parser — in the same change. Adding a field is not breaking; renaming, removing or
re-meaning one bumps `PROTOCOL_VERSION`.

## Layout

```
index.ts                        entry → src/init.ts (config, then the driver)
src/modules/serial-stream.ts    the serial port, reopened every 2 s when lost
src/modules/wt61-decoder.ts     bytes → checksum-valid 11-byte packets
src/modules/sample-assembler.ts packets → one sample per cycle, seq, scaling
src/modules/protocol.ts         the NDJSON lines (the contract, in code)
src/modules/tcp-server.ts       pushes lines to every client, with backpressure
src/modules/driver.ts           wires them together; status every second
scripts/make-fixture.ts         writes the contract fixture
scripts/build-deb.ts            the binary and the .deb (packaging/: unit, maintainer scripts)
```

## The module (WT61 spec V1.0 §7)

Three 11-byte packets per cycle: `0x55 0x51` acceleration (±16 g), `0x55 0x52` angular
velocity (±2000 °/s), `0x55 0x53` angle (±180°), each with temperature (n/340 + 36.53 °C)
and a checksum (low byte of the sum of bytes 0–9). Axes: x right, y up the board, z out of
it; flat at rest it reads z ≈ +1 g. No magnetometer: yaw drifts. The gyro reads exactly 0
below its static threshold (0.122 °/s). The on-chip low-pass filter defaults to 10 Hz.
