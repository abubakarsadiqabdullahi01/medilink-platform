import { env } from './env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON logging. Every line carries a request id and correlation id
 * where one exists, so a single shift or payment can be traced end to end.
 * Never log personal data, document contents or bank details.
 */
export interface LogContext {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  [key: string]: unknown;
}

function emit(level: Level, message: string, context: LogContext = {}) {
  if (ORDER[level] < ORDER[env.LOG_LEVEL]) return;
  const line = JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    env: env.APP_ENV,
    ...context,
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit('debug', m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => emit('info', m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => emit('warn', m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => emit('error', m, { ...base, ...c }),
    };
  },
};
