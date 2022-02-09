import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RouteType } from 'src/payment/models/route/deposit-route.entity';
import { SellService } from 'src/payment/models/sell/sell.service';
import { StakingService } from 'src/payment/models/staking/staking.service';
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

      const newInputs = await this.client
        .getAddressesWithFunds()
        .then((i) => i.filter((e) => e != Config.node.utxoSpenderAddress))
        // get receive history
        .then((a) => this.client.getHistories(a, lastHeight + 1, currentHeight))
        .then((i) => i.filter((h) => ['receive', 'AccountToAccount', 'AccountToUtxos'].includes(h.type)))
        // map to entities
        .then((i) => Promise.all(i.map((h) => this.createEntity(h))))
        .then((i) => i.filter((h) => h != null && h.asset.sellable));

      // save and forward
      if (newInputs.length > 0) {
        console.log('New crypto inputs:', newInputs);

        for (const input of newInputs) {
          await this.saveAndForward(input);
        }
      }
    } catch (e) {
      console.error('Exception during crypto input checks:', e);
    }
  }

  // --- HELPER METHODS --- //
  private async createEntity(history: AccountHistory): Promise<CryptoInput> {
    const { amount, asset: assetName } = this.client.parseAmount(history.amounts[0]);

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

    // get UTXO vout
    const sendUtxo = await this.client.getUtxo().then((utxo) => utxo.find((u) => u.txid === utxoTx));

    // send accountToAccount
    const outTxId = await this.client.sendToken(
      input.route.deposit.address,
      address,
      input.asset.dexName,
      input.amount,
      [{"txid": sendUtxo.txid, "vout": sendUtxo.vout}]
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

  async getAllStakingBalance(stakingIds: number[], date: Date): Promise<{ id: number; balance: number }[]> {
    return this.cryptoInputRepo.getAllStakingBalance(stakingIds, date);
  }
}
