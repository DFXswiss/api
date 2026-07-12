import { AdvancedConsoleLogger, QueryRunner } from 'typeorm';
import { DfxLogger } from './dfx-logger';

// pg NOTICE/NOTIFY messages (e.g. the reconciliation counters our boot-blocking migrations emit via
// RAISE NOTICE) are forwarded by the postgres driver to logger.log('info', ...). The default
// AdvancedConsoleLogger gates 'info'/'warn' behind the SQL_LOGGING option, so in prod (SQL_LOGGING
// unset) those messages are silently swallowed and never reach stdout/Loki. This logger always routes
// 'info'/'warn' through the DfxLogger (same Nest/Loki pipeline as the rest of the app), independent of
// SQL_LOGGING, so migration NOTICEs are never lost. Loki is the PII-free channel, so those NOTICEs must
// carry counters only, never PII (established convention). All other logging is inherited verbatim from
// AdvancedConsoleLogger: queries, schema builds and level 'log' stay env-driven via the SQL_LOGGING
// options this is constructed with, while migration progress is always logged (isLogEnabledFor
// unconditionally enables 'migration' in TypeORM).
export class TypeOrmLogger extends AdvancedConsoleLogger {
  private readonly logger = new DfxLogger(TypeOrmLogger);

  // AdvancedConsoleLogger does not define log() itself (only writeLog()), so this fully replaces
  // AbstractLogger.log for 'info'/'warn': there is no super call and therefore no double-print when
  // SQL_LOGGING enables 'info' for the console logger. Level 'log' stays option-gated via super.
  log(level: 'log' | 'info' | 'warn', message: string, queryRunner?: QueryRunner): void {
    switch (level) {
      case 'info':
        this.logger.info(message);
        break;

      case 'warn':
        this.logger.warn(message);
        break;

      default:
        super.log(level, message, queryRunner);
        break;
    }
  }
}
