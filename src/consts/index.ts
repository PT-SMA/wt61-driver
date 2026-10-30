export const DEFAULT_TCP_PORT = 6699
/** Loopback: the consumer (microservice.hm) runs on the same host. */
export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_DEVICES = ['/dev/ttyUSB0']
/** The WT61's factory rate: 115200 baud streams 100 Hz, 9600 only 20 Hz. */
export const BAUD_RATE = 115200

/** What the compiled binary reads; the .deb installs it. */
export const INSTALLED_CONFIG_FILE = '/etc/default/wt61.conf'
/** Relative to the working directory: development (`bun run`) only. */
export const DEV_CONFIG_FILE = 'etc/configs/config.conf'

/** Wait this long before reopening a lost serial port. */
export const SERIAL_REOPEN_MS = 2000
/** A status line goes to every client this often. */
export const STATUS_INTERVAL_MS = 1000
/** A client this far behind is dropped instead of buffered without limit. */
export const MAX_CLIENT_BACKLOG_BYTES = 256 * 1024
