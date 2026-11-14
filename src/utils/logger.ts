export const logger = {
  info(message: string): void { console.info(message); },
  warn(message: string): void { console.warn(message); },
  error(message: string): void { console.error(message); },
  debug(message: string): void { console.debug(message); }
};
