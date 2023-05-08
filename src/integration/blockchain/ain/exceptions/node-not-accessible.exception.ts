import { NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export class NodeNotAccessibleError extends Error {
  constructor(nodeType: NodeType, e: Error) {
    new DfxLogger(NodeNotAccessibleError).error(`Node is not accessible. Type: ${NodeType.INPUT}`, e);
    super(`Node is not accessible. Type: ${nodeType}`);
  }
}
