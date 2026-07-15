import { TxBroadcastError } from '../tx-broadcast.error';

describe('TxBroadcastError', () => {
  it('sets message and name', () => {
    const error = new TxBroadcastError('broadcast failed');

    expect(error.message).toBe('broadcast failed');
    expect(error.name).toBe('TxBroadcastError');
    expect(error).toBeInstanceOf(Error);
    expect(error.cause).toBeUndefined();
  });

  it('carries the cause through to the Error options', () => {
    const cause = new Error('underlying RPC error');

    const error = new TxBroadcastError('broadcast failed', { cause });

    expect(error.cause).toBe(cause);
  });
});
