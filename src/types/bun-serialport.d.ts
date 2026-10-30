// bun-serialport ships plain JS without type declarations.
// Typed from node_modules/bun-serialport/src and docs/api.md (v0.2.0).

declare module 'bun-serialport' {
  import { EventEmitter } from 'node:events';

  export interface SerialPortOptions {
    path: string;
    baudRate: number;
    dataBits?: 5 | 6 | 7 | 8;
    stopBits?: 1 | 2;
    parity?: 'none' | 'even' | 'odd';
    rtscts?: boolean;
    xon?: boolean;
    xoff?: boolean;
    hupcl?: boolean;
    autoOpen?: boolean;
    readBufferSize?: number;
    readInterval?: number;
  }

  export interface SerialPortError extends Error {
    disconnected?: boolean;
  }

  export interface ModemStatus {
    cts: boolean;
    dsr: boolean;
    dcd: boolean;
    ri: boolean;
  }

  export interface ModemFlags {
    dtr?: boolean;
    rts?: boolean;
  }

  export interface Parser<T> extends EventEmitter<{ data: [T] }> {
    push(chunk: Uint8Array): void;
  }

  export class SerialPort extends EventEmitter<{
    open: [];
    close: [];
    data: [Uint8Array];
    error: [SerialPortError];
  }> {
    constructor(options: SerialPortOptions);
    readonly path: string;
    readonly baudRate: number;
    readonly isOpen: boolean;
    open(): Promise<void>;
    close(): Promise<void>;
    write(data: Uint8Array | ArrayBuffer | number[] | string): Promise<number>;
    update(options: { baudRate?: number }): Promise<void>;
    set(flags: ModemFlags): Promise<void>;
    get(): Promise<ModemStatus>;
    flush(): Promise<void>;
    drain(): Promise<void>;
    pipe<P extends Parser<unknown>>(parser: P): P;
    unpipe(parser?: Parser<unknown>): void;
  }

  export interface PortInfo {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    vendorId?: string;
    productId?: string;
    product?: string;
  }

  export function list(): Promise<PortInfo[]>;

  export function delimiterParser(options?: {
    delimiter?: number | string | ArrayLike<number>;
    includeDelimiter?: boolean;
  }): Parser<Uint8Array>;

  export function byteLengthParser(options?: { length?: number }): Parser<Uint8Array>;

  export function readlineParser(options?: {
    delimiter?: number | string | ArrayLike<number>;
    encoding?: string;
  }): Parser<string>;
}

declare module 'bun-serialport/parsers' {
  export { delimiterParser, byteLengthParser, readlineParser, type Parser } from 'bun-serialport';
}
