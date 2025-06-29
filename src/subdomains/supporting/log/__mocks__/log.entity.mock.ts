import { Log, LogSeverity } from '../log.entity';

const defaultLog: Partial<Log> = {
  id: 1,
  system: '',
  subsystem: '',
  severity: LogSeverity.INFO,
  message: '',
};

export function createDefaultLog(): Log {
  return createCustomLog({});
}

export function createCustomLog(customValues: Partial<Log>): Log {
  return Object.assign(new Log(), { ...defaultLog, ...customValues });
}
