import { BAUD_RATE, DEFAULT_DEVICES, DEFAULT_HOST, DEFAULT_TCP_PORT } from "consts";
import type { DriverConfig } from "types";

/** Defaults for every key — also what runs without a config file. */
export const DEFAULT_CONFIG: DriverConfig = {
  DEVICES: DEFAULT_DEVICES,
  HOST: DEFAULT_HOST,
  PORT: DEFAULT_TCP_PORT,
  BAUD_RATE: BAUD_RATE,
}

/**
 * `KEY=value` lines; `#` starts a comment; quotes and blanks are dropped; a
 * comma separates list values. The last line for a key wins. A number that
 * does not parse is an error, not a silent default.
 */
export function parseConfig(configStr: string): DriverConfig {
  const values: Record<string, string[]> = {}
  for (const raw of configStr.split("\n")) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#") || !line.includes("=")) continue
    const at = line.indexOf("=")
    const key = line.slice(0, at).trim()
    values[key] = line.slice(at + 1).replace(/("|\s)/g, "").split(",").filter((v) => v !== "")
  }

  return {
    // DEVICE (singular) is accepted too: the first version of this parser read it
    DEVICES: values.DEVICES ?? values.DEVICE ?? DEFAULT_CONFIG.DEVICES,
    HOST: values.HOST?.[0] ?? DEFAULT_CONFIG.HOST,
    PORT: number("PORT", values.PORT?.[0], DEFAULT_CONFIG.PORT),
    BAUD_RATE: number("BAUD_RATE", values.BAUD_RATE?.[0], DEFAULT_CONFIG.BAUD_RATE),
  }
}

function number(key: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${key}=${value} is not a positive integer`)
  return n
}
