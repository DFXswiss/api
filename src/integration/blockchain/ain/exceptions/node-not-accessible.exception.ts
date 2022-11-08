import { NodeType } from 'src/integration/blockchain/ain/node/node.service';

export class NodeNotAccessibleError extends Error {
  constructor(nodeType: NodeType, e: Error) {
    console.error(`Node is not accessible. Type: ${NodeType.INPUT}`, e);
    super(`Node is not accessible. Type: ${nodeType}`);
  }
}
