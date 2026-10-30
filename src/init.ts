import { DEV_CONFIG_FILE, INSTALLED_CONFIG_FILE } from 'consts';
import { DEFAULT_CONFIG, parseConfig, SerialStream, Wt61Driver } from 'modules';
import path from 'node:path'
import type { DriverConfig } from 'types';
import pkg from '../package.json';

export class Init {
  readonly description: string = "This codebase is only meant for interfacing WT61C-TTL hardware"
  driver?: Wt61Driver;

  /**
   * `configPath` must exist. Without it the compiled binary reads
   * /etc/default/wt61.conf and `bun run` etc/configs/config.conf; either may be missing.
   */
  constructor(private readonly configPath?: string) {
    this.init = this.init.bind(this);

    this.init().catch((err) => {
      console.error(`wt61-driver: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
  }

  async init() {
    const conf = await this.loadConfig()
    const [dev] = conf.DEVICES;
    if (typeof dev === 'undefined') throw new Error('INVALID DEVICE');
    if (conf.DEVICES.length > 1) {
      console.warn(`only the first device is read: ${dev} (DEVICES=${conf.DEVICES.join(',')})`);
    }
    const streamer = new SerialStream(dev, conf.BAUD_RATE)

    this.driver = new Wt61Driver({
      source: streamer,
      hostname: conf.HOST,
      port: conf.PORT,
      driverVersion: pkg.version,
    })
    this.driver.start()

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, async () => {
        await this.driver?.stop()
        process.exit(0)
      })
    }
  }

  private async loadConfig(): Promise<DriverConfig> {
    const cwd = process.cwd();

    // etc/configs is for development: the built binary never reads it
    const file = this.configPath ??
      (Bun.isStandaloneExecutable ? INSTALLED_CONFIG_FILE : path.join(cwd, DEV_CONFIG_FILE));
    const config = Bun.file(file);
    const configExists = await config.exists();

    if (configExists) {
      const raw = await config.text()
      const parsed = parseConfig(raw)

      return parsed
    } else if (this.configPath) {
      throw new Error(`${file} does not exist`)
    } else {
      console.warn(
        `no ${file}: using the defaults (${Object.entries(DEFAULT_CONFIG).map(([k, v]) => `${k}=${v}`).join(' ')})` +
          (Bun.isStandaloneExecutable
            ? ` — create ${INSTALLED_CONFIG_FILE} to change them`
            : ' — copy etc/configs/config.sample.conf to change them'),
      )

      return DEFAULT_CONFIG
    }
  }
}
