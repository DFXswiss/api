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
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])(
    'returns the original Error for unconditional pre-broadcast syscall code %s',
    (code) => {
      const error = Object.assign(new Error(code), { code });

      expect(toBroadcastBoundaryError(error, [])).toBe(error);
    },
  );

  it('keeps EHOSTUNREACH with syscall connect plain (connect-phase only)', () => {
    const error = Object.assign(new Error('connect EHOSTUNREACH'), {
      code: 'EHOSTUNREACH',
      syscall: 'connect',
    });

    expect(toBroadcastBoundaryError(error, [])).toBe(error);
  });

  it('keeps EHOSTUNREACH with syscall read fail-closed (soft-error after possible delivery)', () => {
    const error = Object.assign(new Error('read EHOSTUNREACH'), {
      code: 'EHOSTUNREACH',
      syscall: 'read',
    });

    expect(toBroadcastBoundaryError(error, [])).toBeInstanceOf(TxBroadcastError);
  });

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
    const parsedRpcError = Object.assign(
      new Error('Bitcoin RPC send failed: insufficient funds', { cause: axiosError }),
      {
        code: -6,
      },
    );

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

  it('keeps a (code, message) pair plain only when the client allowlists exactly that pair', () => {
    const rpcError = Object.assign(new Error('failed to get output distribution'), {
      code: -4,
      message: 'failed to get output distribution',
    });

    expect(
      toBroadcastBoundaryError(rpcError, [], [{ code: -4, message: 'failed to get output distribution' }]),
    ).toBe(rpcError);
    expect(toBroadcastBoundaryError(rpcError, [])).toBeInstanceOf(TxBroadcastError);
  });

  it('does not match a message allowlist entry with the wrong code (guards against generic code aliasing)', () => {
    const rpcError = Object.assign(new Error('failed to get output distribution'), {
      code: -1,
      message: 'failed to get output distribution',
    });

    expect(
      toBroadcastBoundaryError(rpcError, [], [{ code: -4, message: 'failed to get output distribution' }]),
    ).toBeInstanceOf(TxBroadcastError);
  });

  it('does not substring-match a message allowlist entry (exact match only)', () => {
    const rpcError = Object.assign(new Error('boundary'), {
      code: -4,
      message: 'transfer failed: failed to get output distribution (retrying)',
    });

    expect(
      toBroadcastBoundaryError(rpcError, [], [{ code: -4, message: 'failed to get output distribution' }]),
    ).toBeInstanceOf(TxBroadcastError);
  });

  it('requires the allowlisted code and message on the SAME error node', () => {
    // The safety-critical invariant of the pair allowlist. If the matcher were allowed to collect the
    // code from one node and the message from another, an unrelated post-broadcast code (-4 covers
    // tx_rejected too) could be paired with a benign message from anywhere in the cause chain and
    // silently become retryable.
    const splitAcrossNodes = Object.assign(new Error('outer'), {
      code: -4,
      cause: { message: 'failed to get output distribution' },
    });

    expect(
      toBroadcastBoundaryError(splitAcrossNodes, [], [
        { code: -4, message: 'failed to get output distribution' },
      ]),
    ).toBeInstanceOf(TxBroadcastError);
  });

  it('finds an allowlisted (code, message) pair nested behind a cause', () => {
    // The production shape from MoneroClient.mapSendTransfer: the parsed JSON-RPC error object is
    // attached as the cause of the thrown Error, so the walk has to reach it.
    const parsed = { code: -4, message: 'failed to get output distribution' };
    const wrapped = new Error('Monero RPC send failed', { cause: parsed });

    expect(
      toBroadcastBoundaryError(wrapped, [], [{ code: -4, message: 'failed to get output distribution' }]),
    ).toBe(wrapped);
  });

  it('does not classify an allowlisted pair found only in a raw transport response', () => {
    // Mirrors the existing numeric-code guard: response/data payloads are transport details and must
    // never introduce a classifiable pair.
    const axiosError = Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: { error: { code: -4, message: 'failed to get output distribution' } } },
    });

    expect(
      toBroadcastBoundaryError(axiosError, [], [{ code: -4, message: 'failed to get output distribution' }]),
    ).toBeInstanceOf(TxBroadcastError);
  });

  it('keeps a throwing-getter error fail-closed (classifier defaults closed on its own failures)', () => {
    const error = {};
    Object.defineProperty(error, 'code', {
      get() {
        throw new Error('getter boom');
      },
    });

    const result = toBroadcastBoundaryError(error, []);

    expect(result).toBeInstanceOf(TxBroadcastError);
    expect(result.message).toBe('Unclassifiable send error');
    expect(result.cause).toBe(error);
  });
});
