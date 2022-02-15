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
import { Lock } from 'src/shared/lock';

@Injectable()
export class CryptoInputService {
  private readonly client: NodeClient;
  private readonly lock = new Lock(1800);

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
    // avoid overlaps
    if (!this.lock.acquire()) return;

    try {
      // check if node in sync
      const { blocks, headers } = await this.client.getInfo();
      if (blocks < headers - 5) throw new Error('Node not in sync');

      // get block heights
      const currentHeight = blocks;
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
        .then((i) => this.createEntities(i))
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

    this.lock.release();
  }

  // --- HELPER METHODS --- //
  private async createEntities(histories: AccountHistory[]): Promise<CryptoInput[]> {
    const inputs = [];
    for (const history of histories) {
      try {
        inputs.push(await this.createEntity(history));
      } catch (e) {
        console.error(`Failed to process crypto input ${history.txid}:`, e);
      }
    }
    return inputs;
  }

  private async createEntity(history: AccountHistory): Promise<CryptoInput> {
    const { amount: historyAmount, asset: assetName } = this.client.parseAmount(history.amounts[0]);

    // only received token
    if (history.type == 'AccountToAccount' && historyAmount < 0) return null;

    const amount = Math.abs(historyAmount);
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

      // forward (only await UTXO)
      const targetAddress =
        input.route.type === RouteType.SELL ? Config.node.dexWalletAddress : Config.node.stakingWalletAddress;
      input.asset.type === AssetType.COIN
        ? await this.forwardUtxo(input, targetAddress)
        : this.forwardToken(input, targetAddress);
    } catch (e) {
      console.error(`Failed to process crypto input:`, e);
    }
  }

  private async forwardUtxo(input: CryptoInput, address: string): Promise<void> {
    const outTxId = await this.client.sendUtxo(input.route.deposit.address, address, input.amount);
    await this.cryptoInputRepo.update({ id: input.id }, { outTxId });
  }

  private async forwardToken(input: CryptoInput, address: string): Promise<void> {
    // get UTXO
    const utxoTx = await this.client.sendUtxo(
      Config.node.utxoSpenderAddress,
      input.route.deposit.address,
      Config.node.minDfiDeposit / 2,
    );

    await this.client.waitForTx(utxoTx);

    // get UTXO vout
    const sendUtxo = await this.client
      .getUtxo()
      .then((utxos) => utxos.find((u) => u.txid === utxoTx && u.address == input.route.deposit.address));

    // send
    const outTxId = await this.client.sendToken(
      input.route.deposit.address,
      address,
      input.asset.dexName,
      input.amount,
      [sendUtxo],
    );
    await this.cryptoInputRepo.update({ id: input.id }, { outTxId });

    // retrieve remaining UTXO
    await this.retrieveUtxo(outTxId);
  }

  private async retrieveUtxo(txId: string): Promise<void> {
    await this.client.waitForTx(txId);

    const utxo = await this.client.getUtxo().then((utxo) => utxo.find((u) => u.txid === txId));
    if (utxo) {
      await this.client.sendUtxo(utxo.address, Config.node.utxoSpenderAddress, utxo.amount.toNumber());
    }
  }
}
