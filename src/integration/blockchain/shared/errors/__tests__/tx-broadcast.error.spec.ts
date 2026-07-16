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

      expect(toBroadcastBoundaryError(error, [])).toBe(error);
    },
  );

  it('finds a pre-broadcast syscall code through an Error cause', () => {
    const connectionError = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    const outerError = new Error('request failed', { cause: connectionError });

    expect(toBroadcastBoundaryError(outerError, [])).toBe(outerError);
  });

  it('keeps a numeric RPC code plain only when the client allowlists it', () => {
    const rpcError = Object.assign(new Error('insufficient funds'), { code: -6 });

    expect(toBroadcastBoundaryError(rpcError, [-6])).toBe(rpcError);
    expect(toBroadcastBoundaryError(rpcError, [])).toBeInstanceOf(TxBroadcastError);
  });

  it('keeps an allowlisted parsed RPC error plain when Bitcoin Core delivered it over HTTP 500', () => {
    const axiosError = Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: { error: { code: -6, message: 'insufficient funds' } } },
    });
    const parsedRpcError = Object.assign(new Error('Bitcoin RPC send failed: insufficient funds', { cause: axiosError }), {
      code: -6,
    });

    expect(toBroadcastBoundaryError(parsedRpcError, [-6])).toBe(parsedRpcError);
  });

  it('does not classify an RPC-looking code found only in a raw transport response', () => {
    const axiosError = Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: { error: { code: -6, message: 'insufficient funds' } } },
    });

    expect(toBroadcastBoundaryError(axiosError, [-6])).toBeInstanceOf(TxBroadcastError);
  });

  it('handles a cyclic cause chain without recursing forever', () => {
    const cyclicError = new Error('cyclic transport error') as Error & { cause?: unknown };
    cyclicError.cause = cyclicError;

    expect(toBroadcastBoundaryError(cyclicError, [])).toBeInstanceOf(TxBroadcastError);
  });

  it.each(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'])('keeps ambiguous transport code %s fail-closed', (code) => {
    const error = Object.assign(new Error(code), { code });

    expect(toBroadcastBoundaryError(error, [])).toBeInstanceOf(TxBroadcastError);
  });
});
