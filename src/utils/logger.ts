export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(debug: boolean = false): Logger {
  const prefix = "[context-graph]";
  return {
    debug: (message, ...args) => {
      if (debug) console.debug(`${prefix} ${message}`, ...args);
    },
    info: (message, ...args) => console.info(`${prefix} ${message}`, ...args),
    warn: (message, ...args) => console.warn(`${prefix} ${message}`, ...args),
    error: (message, ...args) =>
      console.error(`${prefix} ${message}`, ...args),
  };
}
