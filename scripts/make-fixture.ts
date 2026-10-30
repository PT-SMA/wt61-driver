/**
 * Writes the contract fixture: tests/fixtures/wt61-stream-v1.bin (serial
 * bytes) and wt61-stream-v1.ndjson (what the driver sends for them).
 *
 *   bun run fixture
 *
 * Review the diff by hand — the .ndjson is the contract. Then copy it to
 * microservice.hm/tests/fixtures/wt61/stream-v1.ndjson (its `deno task
 * wt61:verify` compares the two).
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { driverOutput, FIXTURE_BIN, FIXTURE_NDJSON, fixtureBytes } from '../tests/_fixture'

const bytes = fixtureBytes()
await mkdir(path.dirname(FIXTURE_BIN), { recursive: true })
await Bun.write(FIXTURE_BIN, bytes)
await Bun.write(FIXTURE_NDJSON, await driverOutput(bytes))
console.log(`wrote ${FIXTURE_BIN} (${bytes.length} bytes) and ${FIXTURE_NDJSON}`)
