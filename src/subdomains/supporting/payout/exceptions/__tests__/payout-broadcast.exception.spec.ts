import { PayoutBroadcastException } from '../payout-broadcast.exception';

describe('PayoutBroadcastException', () => {
  it('sets message and name', () => {
    const exception = new PayoutBroadcastException('broadcast may be in-flight');

    expect(exception.message).toBe('broadcast may be in-flight');
    expect(exception.name).toBe('PayoutBroadcastException');
    expect(exception).toBeInstanceOf(Error);
    expect(exception.cause).toBeUndefined();
  });

  it('carries the cause through to the Error options', () => {
    const cause = new Error('underlying RPC error');

    const exception = new PayoutBroadcastException('broadcast may be in-flight', { cause });

    expect(exception.cause).toBe(cause);
  });
});
