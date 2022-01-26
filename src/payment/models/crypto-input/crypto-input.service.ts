import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetType } from 'src/shared/models/asset/asset.entity';
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
    this.checkInputs(); // TODO: remove
  }

  // TODO: avoid overlapping calls!
  @Interval(300000)
  async checkInputs(): Promise<void> {
    try {
      // get block heights
      const currentHeight = await this.client.getInfo().then((info) => info.blocks);
      const lastHeight = await this.cryptoInputRepo
        .findOne({ order: { blockHeight: 'DESC' } })
        .then((input) => input?.blockHeight ?? 0);

      await this.client
        .getAddressesWithFunds()
        // Filter out unwanted addresses (aka wallet address)
        .then((i) => i.filter((e) => e != Config.node.utxoSpenderAddress))
        // get receive history
        .then((i) => Promise.all(i.map((a) => this.client.getHistory(a, lastHeight + 1, currentHeight))))
        .then((i) => i.reduce((prev, curr) => prev.concat(curr), []))
        .then((i) => i.filter((h) => h.type === 'receive' || h.type === 'AccountToAccount'))
        // map to entities
        .then((i) => Promise.all(i.map((h) => this.createEntities(h))))
        .then((i) => i.reduce((prev, curr) => prev.concat(curr), []))
        .then((i) => i.filter((h) => h != null && h.asset.sellable))
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
        const { amount, asset: assetName } = this.client.parseAmount(a);

        // only received token
        if (history.type == 'AccountToAccount' && amount < 0) return null;

        const btcAmount = await this.client.testCompositeSwap(history.owner, assetName, 'BTC', amount);
        const usdtAmount = await this.client.testCompositeSwap(history.owner, assetName, 'USDT', amount);

        // min deposit
        if (
          (assetName === 'DFI' && amount < Config.node.minDfiDeposit) ||
          (assetName !== 'DFI' && usdtAmount < Config.node.minTokenDeposit)
        )
          return null;

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
          btcAmount: btcAmount,
          usdtAmount: usdtAmount,
        });
      }),
    );
  }

  private async saveAndForward(input: CryptoInput): Promise<void> {
    try {
      // save
      await this.cryptoInputRepo.save(input);

      // forward
      const targetAddress =
        input.route.type === RouteType.SELL ? Config.node.dexWalletAddress : Config.node.stakingWalletAddress;
      const outTxId =
        input.asset.type === AssetType.COIN
          ? await this.forwardUtxo(input, targetAddress)
          : await this.forwardToken(input, targetAddress);

      // update out TX ID
      await this.cryptoInputRepo.update({ id: input.id }, { outTxId });
    } catch (e) {
      console.error(`Failed to process crypto input:`, e);
    }
  }

  private forwardUtxo(input: CryptoInput, address: string): Promise<string> {
    return this.client.sendUtxo(input.route.deposit.address, address, input.amount);
  }

  private async forwardToken(input: CryptoInput, address: string): Promise<string> {
    // get UTXO
    const utxoTx = await this.client.sendUtxo(Config.node.utxoSpenderAddress, input.route.deposit.address, 0.01);

    await this.client.waitForTx(utxoTx);

    // send accountToAccount
    const outTxId = await this.client.sendToken( // TODO: specify UTXO to use
      input.route.deposit.address,
      address,
      input.asset.dexName,
      input.amount,
    );

    // retrieve remaining UTXO (without waiting)
    this.retrieveUtxo(outTxId);

    return outTxId;
  }

  private async retrieveUtxo(txId: string): Promise<void> {
    await this.client.waitForTx(txId);

    const utxo = await this.client.getUtxo().then((utxo) => utxo.find((u) => u.txid === txId));
    if (utxo) {
      await this.client.sendUtxo(utxo.address, Config.node.utxoSpenderAddress, utxo.amount.toNumber());
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
