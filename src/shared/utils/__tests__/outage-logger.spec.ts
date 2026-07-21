import { isConnectionFailure } from '../outage-logger';

describe('isConnectionFailure', () => {
  it('matches Node system-error codes in the message', () => {
    expect(isConnectionFailure(new Error('connect ETIMEDOUT 203.0.113.10:443'))).toBe(true);
    expect(isConnectionFailure(new Error('socket hang up'))).toBe(true);
  });

  it('matches a code-only error with an unrelated message', () => {
    const error = Object.assign(new Error('request failed'), { code: 'ECONNRESET' });

    expect(isConnectionFailure(error)).toBe(true);
  });

  it('matches a multi-address AggregateError whose members carry only codes', () => {
    const member = Object.assign(new Error(''), { code: 'ETIMEDOUT' });

    expect(isConnectionFailure(new AggregateError([member], ''))).toBe(true);
  });

  it('does not match non-network errors', () => {
    expect(isConnectionFailure(new Error('Price not found'))).toBe(false);
    expect(isConnectionFailure(new Error('query timeout exceeded'))).toBe(false);
    expect(isConnectionFailure(new AggregateError([new Error('some failure')], 'all fail'))).toBe(false);
  });
});
