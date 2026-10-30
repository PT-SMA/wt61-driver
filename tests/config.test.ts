import { expect, test } from 'bun:test'
import { DEFAULT_CONFIG, parseConfig } from 'modules'

test('every key, with quotes, comments and blanks', () => {
  expect(parseConfig(`# devices
DEVICES="/dev/serial/by-id/usb-wt61, /dev/ttyUSB1"

BAUD_RATE=9600
HOST = "0.0.0.0"
PORT=7000
`)).toEqual({
    DEVICES: ['/dev/serial/by-id/usb-wt61', '/dev/ttyUSB1'],
    BAUD_RATE: 9600,
    HOST: '0.0.0.0',
    PORT: 7000,
  })
})

test('DEVICES is the key the config file uses (DEVICE still works)', () => {
  expect(parseConfig('DEVICES="/dev/ttyACM3"').DEVICES).toEqual(['/dev/ttyACM3'])
  expect(parseConfig('DEVICE=/dev/ttyACM4').DEVICES).toEqual(['/dev/ttyACM4'])
})

test('missing keys take the defaults: 115200 baud, 127.0.0.1:6699', () => {
  expect(parseConfig('')).toEqual(DEFAULT_CONFIG)
  expect(DEFAULT_CONFIG).toEqual({
    DEVICES: ['/dev/ttyUSB0'],
    HOST: '127.0.0.1',
    PORT: 6699,
    BAUD_RATE: 115200,
  })
})

test('the last line for a key wins', () => {
  expect(parseConfig('PORT=1\nPORT=2').PORT).toBe(2)
})

test('a number that does not parse is an error, not a silent default', () => {
  expect(() => parseConfig('PORT=abc')).toThrow('PORT=abc')
  expect(() => parseConfig('BAUD_RATE=0')).toThrow('BAUD_RATE=0')
})
