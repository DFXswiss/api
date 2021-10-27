import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellService } from 'src/user/models/sell/sell.service';
import { CryptoInput } from './crypto-input.entity';
import { CryptoInputRepository } from './crypto-input.repository';

@Injectable()
export class CryptoInputService {
  private readonly client: NodeClient;

  constructor(
    nodeService: NodeService,
    private readonly cryptoInputRepo: CryptoInputRepository,
    private readonly assetService: AssetService,
    private readonly sellService: SellService,
  ) {
    this.client = nodeService.getClient(NodeType.INPUT, NodeMode.ACTIVE);
  }

  @Interval(300000)
  async checkInputs(): Promise<void> {
    try {
      // get block heights
      const currentHeight = await this.client.getInfo().then((info) => info.blocks);
      const lastHeight = await this.cryptoInputRepo
        .findOne({ order: { blockHeight: 'DESC' } })
        .then((input) => input?.blockHeight ?? 0);

      // TODO: ignore own wallet address (UTXO holdings)

      await this.client
        // get UTXOs >= 0.1 DFI
        .getUtxo()
        .then((i) => i.filter((u) => u.amount.toNumber() >= 0.1))
        // get receive history
        .then((i) => Promise.all(i.map((u) => this.client.getHistory(u.address, lastHeight + 1, currentHeight))))
        .then((i) => i.reduce((prev, curr) => prev.concat(curr), []))
        .then((i) => i.filter((h) => h.type === 'receive'))
        // map to entities
        .then((i) => Promise.all(i.map((h) => this.createEntities(h))))
        .then((i) => i.reduce((prev, curr) => prev.concat(curr), []))
        .then((i) => i.filter((e) => e != null))
        // save and forward
        .then((i) => Promise.all(i.map((e) => this.saveAndForward(e))));
    } catch (e) {
      console.error('Exception during crypto input checks:', e);
    }
  }

  // --- HELPER METHODS --- //
  private async createEntities(history: AccountHistory): Promise<CryptoInput[]> {
    return Promise.all(
      history.amounts.map(async (a) => {
        const amount = +a.split('@')[0];
        const assetName = a.split('@')[1];

        // get asset
        const asset = await this.assetService.getAsset(assetName);
        if (!asset) {
          console.error(`Failed to process crypto input. No asset ${assetName} found. History entry: `, history);
          return null;
        }

        // get sell route
        const sell = await this.sellService.getSellForAddress(history.owner);
        if (!sell) {
          console.error(`Failed to process crypto input. No matching sell found. History entry: `, history);
          return null;
        }

        return this.cryptoInputRepo.create({
          inTxId: history.txid,
          outTxId: '', // will be set after crypto forward
          blockHeight: history.blockHeight,
          amount: amount,
          asset: asset,
          sell: sell,
        });
      }),
    );
  }

  private async saveAndForward(input: CryptoInput): Promise<void> {
    try {
      // save
      await this.cryptoInputRepo.save(input);

      // get user wallet address (TODO: remove!)
      const inputWithUser = await this.cryptoInputRepo.findOne({
        where: { id: input.id },
        relations: ['sell', 'sell.user'],
      });
      console.log('Input with user: ', inputWithUser);
      const userAddress = await this.cryptoInputRepo
        .createQueryBuilder('input')
        .leftJoin('input.sell', 'sell')
        .leftJoin('sell.user', 'user')
        .where('input.id = :id', { id: 1 })
        .addSelect(['sell.id', 'user.address'])
        .getOne()
        .then((i) => i.sell.user.address);

      // forward
      // TODO: switch on type (for Token)
      const outTxId = await this.client.sendUtxo(
        input.sell.deposit.address,
        userAddress, // TODO: process.env.HOT_WALLET_ADDRESS,
        input.amount,
      );

      // update out TX ID
      await this.cryptoInputRepo.update({ id: input.id }, { outTxId });
    } catch (e) {
      console.error(`Failed to process crypto input: `, e);
    }
  }
}
