import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'MEDIA' | 'NETWORK';

export class Logger {
  #stream: fs.WriteStream;

  constructor(logDir: string) {
    fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, `verdant-${new Date().toISOString().slice(0, 10)}.log`);
    this.#stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  }

  log(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
    const safe = sanitizeContext(context);
    const record = { ts: new Date().toISOString(), level, message, ...safe };
    const line = JSON.stringify(record);
    this.#stream.write(`${line}\n`);
    const consoleLine = `[${level}] ${message}${Object.keys(safe).length ? ` ${JSON.stringify(safe)}` : ''}`;
    if (level === 'ERROR') console.error(consoleLine);
    else if (level === 'WARN') console.warn(consoleLine);
    else console.log(consoleLine);
  }

  info(message: string, context?: Record<string, unknown>): void { this.log('INFO', message, context); }
  warn(message: string, context?: Record<string, unknown>): void { this.log('WARN', message, context); }
  error(message: string, context?: Record<string, unknown>): void { this.log('ERROR', message, context); }
  network(message: string, context?: Record<string, unknown>): void { this.log('NETWORK', message, context); }
  media(message: string, context?: Record<string, unknown>): void { this.log('MEDIA', message, context); }
}

function sanitizeContext(input: Record<string, unknown>): Record<string, unknown> {
  const blocked = /password|secret|token|authorization|cookie|audio|video/i;
  return Object.fromEntries(Object.entries(input).filter(([key]) => !blocked.test(key)));
}
