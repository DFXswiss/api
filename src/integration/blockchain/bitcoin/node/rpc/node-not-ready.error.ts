// JSON-RPC error code returned by bitcoind/firo while the node is still starting
// up (loading block index, verifying blocks, loading wallet). Transient: the node
// is up and becomes ready within ~1 min, typically right after a deploy/restart.
export const RPC_IN_WARMUP = -28;

export class NodeNotReadyError extends Error {
  readonly code = RPC_IN_WARMUP;

  constructor(method: string, message: string) {
    super(`Bitcoin RPC ${method} failed: ${message}`);
    this.name = NodeNotReadyError.name;
  }
}
