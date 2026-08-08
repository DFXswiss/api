import { DfxLogger } from '../../services/dfx-logger';
import { safeLogError } from '../safe-log';

describe('safeLogError', () => {
  it('forwards message and error to logger.error without throwing', () => {
    const errorFn = jest.fn();
    const logger = { error: errorFn } as unknown as DfxLogger;
    const error = new Error('boom');

    expect(() => safeLogError(logger, 'something failed:', error)).not.toThrow();
    expect(errorFn).toHaveBeenCalledTimes(1);
    expect(errorFn).toHaveBeenCalledWith('something failed:', error);
  });

  it('falls back to a message-only log when logger.error throws and does not rethrow', () => {
    const errorFn = jest
      .fn()
      .mockImplementationOnce(() => {
        // Simulate DfxLogger.format / span.recordException hitting a hostile Proxy getter.
        throw new Error('hostile stack getter');
      })
      .mockImplementationOnce(() => undefined);
    const logger = { error: errorFn } as unknown as DfxLogger;
    const error = new Error('boom');

    expect(() => safeLogError(logger, 'something failed:', error)).not.toThrow();
    expect(errorFn).toHaveBeenCalledTimes(2);
    expect(errorFn).toHaveBeenNthCalledWith(1, 'something failed:', error);
    expect(errorFn).toHaveBeenNthCalledWith(2, 'something failed: (original error could not be logged)');
    expect(errorFn.mock.calls[1]).toHaveLength(1);
  });

  it('swallows a second failure so a broken logger cannot end the process', () => {
    const errorFn = jest.fn().mockImplementation(() => {
      throw new Error('logger is broken');
    });
    const logger = { error: errorFn } as unknown as DfxLogger;

    expect(() => safeLogError(logger, 'something failed:', new Error('boom'))).not.toThrow();
    expect(errorFn).toHaveBeenCalledTimes(2);
  });
});
