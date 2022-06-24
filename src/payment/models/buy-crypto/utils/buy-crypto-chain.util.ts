import { Injectable } from '@nestjs/common';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoChainUtil {
  private dexClient: NodeClient;

  constructor(private readonly buyCryptoRepo: BuyCryptoRepository, readonly nodeService: NodeService) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async getRecentChainHistory(): Promise<{ txId: string; blockHeight: number; amounts: string[] }[]> {
    const { blocks: currentHeight } = await this.dexClient.getInfo();
    const lastHeight = await this.buyCryptoRepo
      .findOne({ order: { blockHeight: 'DESC' } })
      .then((tx) => tx?.blockHeight ?? 0);

    return await this.dexClient
      .getHistories([Config.node.dexWalletAddress, Config.node.outWalletAddress], lastHeight - 1000, currentHeight)
      .then((h) => h.map((h) => ({ txId: h.txid, blockHeight: h.blockHeight, amounts: h.amounts })));
  }
}
