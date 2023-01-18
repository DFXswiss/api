import { NodeClient } from 'src/integration/blockchain/ain/node/node-client';

export abstract class PayInJellyfishService {
  protected async checkNodeInSync(client: NodeClient): Promise<{ headers: number; blocks: number }> {
    const { blocks, headers } = await client.getInfo();
    if (blocks < headers - 1) throw new Error(`Node not in sync by ${headers - blocks} block(s)`);

    return { headers, blocks };
  }
}
