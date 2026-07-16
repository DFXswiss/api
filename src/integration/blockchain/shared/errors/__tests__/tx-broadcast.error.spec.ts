import { TxBroadcastError, toBroadcastBoundaryError } from '../tx-broadcast.error';

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

describe('toBroadcastBoundaryError', () => {
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'])(
    'returns the original Error for pre-broadcast syscall code %s',
    (code) => {
      const error = Object.assign(new Error(code), { code });

      expect(toBroadcastBoundaryError(error)).toBe(error);
    },
  );

  it('finds a pre-broadcast syscall code through an Error cause', () => {
    const connectionError = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    const outerError = new Error('request failed', { cause: connectionError });

    expect(toBroadcastBoundaryError(outerError)).toBe(outerError);
  });

  it('keeps a numeric RPC code plain only when the client allowlists it', () => {
    const rpcError = Object.assign(new Error('insufficient funds'), { code: -6 });

    expect(toBroadcastBoundaryError(rpcError, [-6])).toBe(rpcError);
    expect(toBroadcastBoundaryError(rpcError)).toBeInstanceOf(TxBroadcastError);
  });

  it('keeps HTTP error responses fail-closed even when their RPC body contains an allowlisted code', () => {
    const axiosError = Object.assign(new Error('HTTP 500'), {
      response: { status: 500, data: { error: { code: -6, message: 'insufficient funds' } } },
    });

    expect(toBroadcastBoundaryError(axiosError, [-6])).toBeInstanceOf(TxBroadcastError);
  });

  it.each(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'])(
    'keeps ambiguous transport code %s fail-closed',
    (code) => {
      const error = Object.assign(new Error(code), { code });

      expect(toBroadcastBoundaryError(error)).toBeInstanceOf(TxBroadcastError);
    },
  );
});
