import { expect, test } from 'bun:test'
import { SerialStream } from 'modules'
import type { SerialState } from 'types'

test('a device that is not there: closed with the reason, retried, never thrown', async () => {
  const stream = new SerialStream('/dev/wt61-driver-test-missing', 115200, 20)
  const states: [SerialState, string | undefined][] = []
  stream.event.on('state', (state, reason) => states.push([state, reason]))
  stream.start()
  await Bun.sleep(120)
  await stream.stop()
  expect(stream.state).toBe('closed')
  expect(stream.lastError).toBeString()
  // retried several times, but reported once: the reason did not change
  expect(states.length).toBe(1)
  expect(states[0]![0]).toBe('closed')
})
