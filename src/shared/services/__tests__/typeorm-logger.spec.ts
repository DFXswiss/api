import { AdvancedConsoleLogger, LoggerOptions } from 'typeorm';
import { DfxLogger } from '../dfx-logger';
import { TypeOrmLogger } from '../typeorm-logger';

// writeLog is the protected AdvancedConsoleLogger sink for the option-gated console path. Spying it lets
// us assert both that 'info'/'warn' never reach the console path (no duplication) and that 'log' / query
// logging still respect SQL_LOGGING via the inherited methods.
type WriteLogAccess = { writeLog: (...args: unknown[]) => void };

describe('TypeOrmLogger', () => {
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation();
    warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();
    writeSpy = jest
      .spyOn(AdvancedConsoleLogger.prototype as unknown as WriteLogAccess, 'writeLog')
      .mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // undefined = SQL_LOGGING unset (prod), false = disabled, 'all' = every level enabled
  const allOptions: (LoggerOptions | undefined)[] = [undefined, false, 'all'];

  describe('info (pg RAISE NOTICE reconciliation counters)', () => {
    it.each(allOptions)('always forwards level info to the DfxLogger, independent of SQL_LOGGING (%s)', (options) => {
      new TypeOrmLogger(options).log('info', 'backfill reconciliation: deleted=7, kept=2');

      expect(infoSpy).toHaveBeenCalledWith('backfill reconciliation: deleted=7, kept=2');
      // fully overridden: no super call, so no duplication even when SQL_LOGGING enables 'info'
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it.each(allOptions)('always forwards level warn to the DfxLogger, independent of SQL_LOGGING (%s)', (options) => {
      new TypeOrmLogger(options).log('warn', 'Postgres pool raised an error.');

      expect(warnSpy).toHaveBeenCalledWith('Postgres pool raised an error.');
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe("level 'log' stays option-gated (delegated to the inherited console logger)", () => {
    it('is swallowed when SQL_LOGGING is unset and never reaches the DfxLogger', () => {
      new TypeOrmLogger(undefined).log('log', 'schema note');

      expect(writeSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("delegates to the console logger when SQL_LOGGING enables it ('all'), not to the DfxLogger", () => {
      new TypeOrmLogger('all').log('log', 'schema note');

      expect(writeSpy).toHaveBeenCalledWith('log', expect.objectContaining({ type: 'log' }), undefined);
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('inherited query logging respects SQL_LOGGING', () => {
    it('does not log queries when SQL_LOGGING is unset', () => {
      new TypeOrmLogger(undefined).logQuery('SELECT 1');

      expect(writeSpy).not.toHaveBeenCalled();
    });

    it("logs queries when SQL_LOGGING is 'all'", () => {
      new TypeOrmLogger('all').logQuery('SELECT 1');

      expect(writeSpy).toHaveBeenCalledWith('query', expect.objectContaining({ type: 'query' }), undefined);
    });
  });
});
