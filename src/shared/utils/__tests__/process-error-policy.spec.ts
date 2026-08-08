import { isToleratedProcessError } from '../process-error-policy';

describe('isToleratedProcessError', () => {
  it('returns false for undefined', () => {
    expect(isToleratedProcessError(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isToleratedProcessError(null)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isToleratedProcessError('Channel has been shut down')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isToleratedProcessError(42)).toBe(false);
  });

  it('returns false for an object without a message property', () => {
    expect(isToleratedProcessError({ code: 'ECONNRESET' })).toBe(false);
  });

  it('returns false for an object created with a null prototype', () => {
    expect(isToleratedProcessError(Object.create(null))).toBe(false);
  });

  it('returns false for a non-matching Error', () => {
    expect(isToleratedProcessError(new Error('something else failed'))).toBe(false);
  });

  it('returns true for an Error whose message contains Channel has been shut down', () => {
    expect(isToleratedProcessError(new Error('Channel has been shut down'))).toBe(true);
  });

  it('returns true for an Error whose constructor name contains Spark', () => {
    class SparkNetworkError extends Error {}
    expect(isToleratedProcessError(new SparkNetworkError('network blip'))).toBe(true);
  });

  it('returns true for a plain object with a matching message', () => {
    expect(isToleratedProcessError({ message: 'grpc: Channel has been shut down' })).toBe(true);
  });

  it('returns true for a null-prototype object with a matching message', () => {
    const error = Object.create(null) as { message: string };
    error.message = 'Channel has been shut down';
    expect(isToleratedProcessError(error)).toBe(true);
  });

  it('returns false when message is present but not a string', () => {
    expect(isToleratedProcessError({ message: 123 })).toBe(false);
  });

  it('returns false when property access throws', () => {
    const error = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile getter');
        },
      },
    );

    expect(isToleratedProcessError(error)).toBe(false);
  });
});
