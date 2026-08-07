import { DfxLogger } from 'src/shared/services/dfx-logger';
import { handleBootstrapFailure } from '../bootstrap-failure';

describe('handleBootstrapFailure', () => {
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('logs an Error instance as-is and exits with 1', () => {
    const err = new Error('boot boom');

    handleBootstrapFailure(err);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Bootstrap failed:', err);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('wraps a non-Error value in Error(String(error)) and exits with 1', () => {
    handleBootstrapFailure('string failure');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0][1] as Error;
    expect(logged).toBeInstanceOf(Error);
    expect(logged.message).toBe('string failure');
    expect(logged).not.toBe('string failure');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
