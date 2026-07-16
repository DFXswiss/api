// Generic marker for a failure of the actual on-chain send call (wallet.sendTransaction /
// contract.transfer). Deliberately not payout-specific - this client is shared by dex, payin and
// faucet callers too, which keep catching plain Error via catch(e) and logging e.message.
export class TxBroadcastError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TxBroadcastError';
  }
}

// Connection-establishment failures where the request provably never reached the node.
const PRE_BROADCAST_SYSCALL_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'];

type ErrorShape = {
  cause?: unknown;
  code?: unknown;
  data?: unknown;
  error?: unknown;
  message?: unknown;
  response?: unknown;
  status?: unknown;
};

// Send-boundary classification is deliberately fail-closed:
// - Class A: connection-establishment failures are plain errors because the request never reached the node.
// - Class B: only client-provided, numeric RPC codes that prove funding failed before tx creation are plain.
// - Class C: timeouts, resets, HTTP errors and every unknown/ambiguous shape stay TxBroadcastError.
export function toBroadcastBoundaryError(e: unknown, preBroadcastRpcCodes: number[] = []): Error {
  if (e instanceof TxBroadcastError) return e;

  // An HTTP error response proves the request reached a server. Even when its body contains an
  // allowlisted RPC code, the transport outcome is ambiguous and therefore remains fail-closed.
  const hasHttpErrorResponse = walkErrorShape(e, (value) => {
    const status = value.status;
    return typeof status === 'number' && status >= 400;
  });

  const isPreBroadcastSyscall = walkErrorShape(
    e,
    (value) => typeof value.code === 'string' && PRE_BROADCAST_SYSCALL_CODES.includes(value.code),
  );
  const isPreBroadcastRpcError = walkErrorShape(
    e,
    (value) => typeof value.code === 'number' && preBroadcastRpcCodes.includes(value.code),
  );

  if (!hasHttpErrorResponse && (isPreBroadcastSyscall || isPreBroadcastRpcError)) return asError(e);

  const error = asError(e);
  return new TxBroadcastError(error.message, { cause: e });
}

function walkErrorShape(value: unknown, matches: (value: ErrorShape) => boolean, seen = new Set<object>()): boolean {
  if (!isErrorShape(value) || seen.has(value)) return false;

  seen.add(value);
  if (matches(value)) return true;

  return [value.cause, value.error, value.response, value.data].some((nested) => walkErrorShape(nested, matches, seen));
}

function isErrorShape(value: unknown): value is ErrorShape {
  return typeof value === 'object' && value !== null;
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;

  const message = isErrorShape(value) && typeof value.message === 'string' ? value.message : String(value);
  return new Error(message, { cause: value });
}
