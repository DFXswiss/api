import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RouteType } from 'src/user/models/deposit/deposit-route.entity';
import { SellService } from 'src/user/models/sell/sell.service';
import { StakingService } from 'src/user/models/staking/staking.service';
import { SelectQueryBuilder } from 'typeorm';
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
    private readonly stakingService: StakingService,
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
        // get distinct addresses
        .then((i) => i.map((u) => u.address))
        .then((i) => i.filter((u, j) => i.indexOf(u) === j))
        // get receive history
        .then((i) => Promise.all(i.map((a) => this.client.getHistory(a, lastHeight + 1, currentHeight))))
        .then((i) => i.reduce((prev, curr) => prev.concat(curr), []))
        .then((i) => i.filter((h) => h.type === 'receive'))
        // map to entities
        .then((i) => Promise.all(i.map((h) => this.createEntities(h))))
        .then((i) => i.reduce((prev, curr) => prev.concat(curr), []))
        .then((i) => i.filter((e) => e != null && e.amount >= 0.1)) // min. deposit limit
        .then((i) => {
          if (i.length > 0) console.log('New crypto inputs:', i);
          return i;
        })
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
        const asset = await this.assetService.getAssetByDexName(assetName);
        if (!asset) {
          console.error(`Failed to process crypto input. No asset ${assetName} found. History entry:`, history);
          return null;
        }

        // get deposit route
        const route =
          (await this.sellService.getSellForAddress(history.owner)) ??
          (await this.stakingService.getStakingForAddress(history.owner));
        if (!route) {
          console.error(`Failed to process crypto input. No matching route found. History entry:`, history);
          return null;
        }

        // only DFI for staking
        if (route.type === RouteType.STAKING && asset.name != 'DFI') {
          console.log('Ignoring non-DFI crypto input on staking route. History entry:', history);
          return null;
        }

        return this.cryptoInputRepo.create({
          inTxId: history.txid,
          outTxId: '', // will be set after crypto forward
          blockHeight: history.blockHeight,
          amount: amount,
          asset: asset,
          route: route,
        });
      }),
    );
  }

  private async saveAndForward(input: CryptoInput): Promise<void> {
    try {
      // save
      await this.cryptoInputRepo.save(input);

      // store BTC/USDT price
      const btcAmount = await this.client.testPoolSwap(input.route.deposit.address, 'DFI', 'BTC', input.amount);
      const usdtAmount = await this.client.testPoolSwap(input.route.deposit.address, 'DFI', 'USDT', input.amount);
      await this.cryptoInputRepo.update(
        { id: input.id },
        { btcAmount: +btcAmount.split('@')[0], usdtAmount: +usdtAmount.split('@')[0] },
      );

      // forward
      const targetAddress =
        input.route.type === RouteType.SELL ? Config.node.dexWalletAddress : Config.node.stakingWalletAddress;

      // TODO: switch on type (for Token)
      const outTxId = await this.client.sendUtxo(
        input.route.deposit.address,
        targetAddress,
        input.amount,
      );

      // update out TX ID
      await this.cryptoInputRepo.update({ id: input.id }, { outTxId });
    } catch (e) {
      console.error(`Failed to process crypto input:`, e);
    }
  }

  async getStakingBalance(stakingId: number, date: Date): Promise<number> {
    const { balance } = await this.getInputsForStakingPeriod(date)
      .select('SUM(amount)', 'balance')
      .andWhere('route.id = :stakingId', { stakingId })
      .getRawOne<{ balance: number }>();

    return balance;
  }

  async getAllStakingBalance(stakingIds: number[], date: Date): Promise<{ id: number; balance: number }[]> {
    const inputs = await this.getInputsForStakingPeriod(date)
      .andWhere('route.id IN (:...stakingIds)', { stakingIds })
      .getMany();

    return stakingIds.map((id) => ({
      id,
      balance: inputs.filter((i) => i.route.id === id).reduce((prev, curr) => prev + curr.amount, 0),
    }));
  }

  private getInputsForStakingPeriod(dateTo: Date): SelectQueryBuilder<CryptoInput> {
    const dateFrom = new Date(dateTo);
    dateFrom.setDate(dateTo.getDate() - Config.stakingPeriod);

    return this.cryptoInputRepo
      .createQueryBuilder('cryptoInput')
      .innerJoinAndSelect('cryptoInput.route', 'route')
      .where('route.type = :type', { type: RouteType.STAKING })
      .andWhere('cryptoInput.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });
  }
}
