import { DfxLogger } from '../../services/dfx-logger';
import { handleUncaughtException, handleUnhandledRejection, ProcessErrorHandlerDeps } from '../process-error-handlers';

function createDeps(overrides?: { errorFn?: jest.Mock; exitFn?: jest.Mock }): {
  deps: ProcessErrorHandlerDeps;
  errorFn: jest.Mock;
  exitFn: jest.Mock;
} {
  const errorFn = overrides?.errorFn ?? jest.fn();
  const exitFn = overrides?.exitFn ?? jest.fn();
  const deps: ProcessErrorHandlerDeps = {
    logger: { error: errorFn } as unknown as DfxLogger,
    exit: exitFn,
  };
  return { deps, errorFn, exitFn };
}

function createHostileProxy(): object {
  return new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('hostile');
      },
    },
  );
}

function createUnstringifiable(): object {
  return {
    [Symbol.toPrimitive](): string {
      throw new Error('cannot convert');
    },
    toString(): string {
      throw new Error('cannot convert');
    },
    valueOf(): string {
      throw new Error('cannot convert');
    },
  };
}

class SparkNetworkError extends Error {}

describe('handleUncaughtException', () => {
  it('keeps the process alive for a tolerated Spark constructor name', () => {
    const { deps, errorFn, exitFn } = createDeps();
    const error = new SparkNetworkError('network blip');

    handleUncaughtException(error, deps);

    expect(exitFn).not.toHaveBeenCalled();
    expect(errorFn).toHaveBeenCalledTimes(1);
    expect(errorFn).toHaveBeenCalledWith('Spark SDK uncaught exception (process kept alive):', error);
  });

  it('keeps the process alive for a tolerated Channel has been shut down message', () => {
    const { deps, exitFn } = createDeps();
    const error = new Error('Channel has been shut down');

    handleUncaughtException(error, deps);

    expect(exitFn).not.toHaveBeenCalled();
  });

  it('exits once for a non-tolerated error', () => {
    const { deps, errorFn, exitFn } = createDeps();
    const error = new Error('boom');

    handleUncaughtException(error, deps);

    expect(exitFn).toHaveBeenCalledTimes(1);
    expect(errorFn).toHaveBeenCalledTimes(1);
    expect(errorFn).toHaveBeenCalledWith('Uncaught exception, shutting down:', error);
  });

  it('does not throw on a hostile Proxy and still exits when not tolerated', () => {
    const { deps, exitFn } = createDeps();
    const hostile = createHostileProxy();

    expect(() => handleUncaughtException(hostile, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw when logger.error always throws and still exits for a non-tolerated error', () => {
    const errorFn = jest.fn(() => {
      throw new Error('logger is broken');
    });
    const { deps, exitFn } = createDeps({ errorFn });

    expect(() => handleUncaughtException(new Error('boom'), deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw when logger.error always throws for a tolerated error and does not exit', () => {
    const errorFn = jest.fn(() => {
      throw new Error('logger is broken');
    });
    const { deps, exitFn } = createDeps({ errorFn });

    expect(() => handleUncaughtException(new SparkNetworkError('network blip'), deps)).not.toThrow();
    expect(exitFn).not.toHaveBeenCalled();
  });

  it('does not throw and exits for undefined', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUncaughtException(undefined, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for null', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUncaughtException(null, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for a plain string', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUncaughtException('plain failure', deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('logs a non-Error rejection with its value, distinguishable from an exception', () => {
    const { deps, errorFn, exitFn } = createDeps();

    handleUnhandledRejection('plain failure', deps);

    const logged = errorFn.mock.calls[0][1] as Error;
    expect(logged).toBeInstanceOf(Error);
    expect(logged.message).toBe('Non-Error rejection: plain failure');
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('logs a non-Error exception with its value, distinguishable from a rejection', () => {
    const { deps, errorFn, exitFn } = createDeps();

    handleUncaughtException('plain failure', deps);

    const logged = errorFn.mock.calls[0][1] as Error;
    expect(logged).toBeInstanceOf(Error);
    expect(logged.message).toBe('Non-Error exception: plain failure');
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for a number', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUncaughtException(42, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for an object without a prototype', () => {
    const { deps, exitFn } = createDeps();
    const value = Object.create(null) as Record<string, unknown>;

    expect(() => handleUncaughtException(value, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for a null-prototype object with a non-tolerating message', () => {
    const { deps, exitFn } = createDeps();
    const value = Object.create(null) as { message: string };
    value.message = 'something else';

    expect(() => handleUncaughtException(value, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for an unstringifiable non-Error value', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUncaughtException(createUnstringifiable(), deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });
});

describe('handleUnhandledRejection', () => {
  it('keeps the process alive for a tolerated Spark constructor name', () => {
    const { deps, errorFn, exitFn } = createDeps();
    const error = new SparkNetworkError('network blip');

    handleUnhandledRejection(error, deps);

    expect(exitFn).not.toHaveBeenCalled();
    expect(errorFn).toHaveBeenCalledTimes(1);
    expect(errorFn).toHaveBeenCalledWith('Spark SDK unhandled rejection (process kept alive):', error);
  });

  it('keeps the process alive for a tolerated Channel has been shut down message', () => {
    const { deps, exitFn } = createDeps();
    const error = new Error('Channel has been shut down');

    handleUnhandledRejection(error, deps);

    expect(exitFn).not.toHaveBeenCalled();
  });

  it('exits once for a non-tolerated error', () => {
    const { deps, errorFn, exitFn } = createDeps();
    const error = new Error('boom');

    handleUnhandledRejection(error, deps);

    expect(exitFn).toHaveBeenCalledTimes(1);
    expect(errorFn).toHaveBeenCalledTimes(1);
    expect(errorFn).toHaveBeenCalledWith('Unhandled rejection, shutting down:', error);
  });

  it('does not throw on a hostile Proxy and still exits when not tolerated', () => {
    const { deps, exitFn } = createDeps();
    const hostile = createHostileProxy();

    expect(() => handleUnhandledRejection(hostile, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw when logger.error always throws and still exits for a non-tolerated error', () => {
    const errorFn = jest.fn(() => {
      throw new Error('logger is broken');
    });
    const { deps, exitFn } = createDeps({ errorFn });

    expect(() => handleUnhandledRejection(new Error('boom'), deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw when logger.error always throws for a tolerated error and does not exit', () => {
    const errorFn = jest.fn(() => {
      throw new Error('logger is broken');
    });
    const { deps, exitFn } = createDeps({ errorFn });

    expect(() => handleUnhandledRejection(new SparkNetworkError('network blip'), deps)).not.toThrow();
    expect(exitFn).not.toHaveBeenCalled();
  });

  it('does not throw and exits for undefined', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUnhandledRejection(undefined, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for null', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUnhandledRejection(null, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for a plain string', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUnhandledRejection('plain failure', deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for a number', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUnhandledRejection(42, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for an object without a prototype', () => {
    const { deps, exitFn } = createDeps();
    const value = Object.create(null) as Record<string, unknown>;

    expect(() => handleUnhandledRejection(value, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for a null-prototype object with a non-tolerating message', () => {
    const { deps, exitFn } = createDeps();
    const value = Object.create(null) as { message: string };
    value.message = 'something else';

    expect(() => handleUnhandledRejection(value, deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });

  it('does not throw and exits for an unstringifiable non-Error value', () => {
    const { deps, exitFn } = createDeps();

    expect(() => handleUnhandledRejection(createUnstringifiable(), deps)).not.toThrow();
    expect(exitFn).toHaveBeenCalledTimes(1);
  });
});
