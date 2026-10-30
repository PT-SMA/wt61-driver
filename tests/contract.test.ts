import { expect, test } from 'bun:test'
import { driverOutput, FIXTURE_BIN, FIXTURE_NDJSON, fixtureBytes } from './_fixture'

// The contract with microservice.hm: these bytes in, exactly these lines out.
// microservice.hm checks its parser against a byte-identical copy of the
// .ndjson. If this fails on purpose, regenerate (`bun run fixture`), review
// the diff, update the contract doc, and copy the file to microservice.hm.

test('the fixture bytes are what the generator builds', async () => {
  expect([...new Uint8Array(await Bun.file(FIXTURE_BIN).arrayBuffer())]).toEqual([...fixtureBytes()])
})

test('the driver sends exactly the fixture lines for the fixture bytes', async () => {
  const bytes = new Uint8Array(await Bun.file(FIXTURE_BIN).arrayBuffer())
  expect(await driverOutput(bytes)).toBe(await Bun.file(FIXTURE_NDJSON).text())
})

test('every fixture line is one JSON object with a type, within 1 KB', async () => {
  const lines = (await Bun.file(FIXTURE_NDJSON).text()).split('\n')
  expect(lines.pop()).toBe('')
  for (const line of lines) {
    expect(line.length).toBeLessThanOrEqual(1024)
    expect(typeof JSON.parse(line).type).toBe('string')
  }
  expect(lines.map((l) => JSON.parse(l).type)).toEqual([
    'hello', 'status', 'sample', 'sample', 'sample', 'sample', 'status',
  ])
  expect(lines.filter((l) => l.includes('"sample"')).map((l) => JSON.parse(l).seq)).toEqual([1, 2, 4, 6])
})
