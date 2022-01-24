import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Sell } from 'src/user/models/sell/sell.entity';
import { SellService } from 'src/user/models/sell/sell.service';
import { Staking } from 'src/user/models/staking/staking.entity';
import { StakingService } from 'src/user/models/staking/staking.service';
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
        .then((i) => i.filter((e) => e != 'tWGFApzyspQaMmyhyBfn8igS5EHcbuG23F')) // TODO: get from config
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

        // min deposit 0.1 DFI / 1 USD
        if ((assetName === 'DFI' && amount < 0.1) || (assetName !== 'DFI' && usdtAmount < 1)) return null;

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
        if (route instanceof Staking && asset.name != 'DFI') {
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
      const targetAddress = 'iban' in input.route ? Config.node.dexWalletAddress : Config.node.stakingWalletAddress;
      const outTxId =
        input.asset.type === AssetType.COIN
          ? await this.forwardUtxo(input, targetAddress)
          : await this.forwardToken(input, targetAddress);

      // update out TX ID
      await this.cryptoInputRepo.update({ id: input.id }, { outTxId });

      // Cleanup
      const unspent = (await this.client.getUtxo()).filter(
        (i) => i.address == input.route.deposit.address && i.spendable,
      );

      const utxosum = unspent.reduce((a, b) => a + +b.amount, 0);
      if (utxosum > 0) {
        const utxoTx = await this.client.sendUtxo(
          input.route.deposit.address,
          'tWGFApzyspQaMmyhyBfn8igS5EHcbuG23F', // TODO: get from config
          utxosum,
        );
      }
    } catch (e) {
      console.error(`Failed to process crypto input:`, e);
    }
  }

  private forwardUtxo(input: CryptoInput, address: string): Promise<string> {
    return this.client.sendUtxo(input.route.deposit.address, address, input.amount);
  }

  private async forwardToken(input: CryptoInput, address: string): Promise<string> {
    // 1. get UTXO
    const utxoTx = await this.client.sendUtxo(
      'tWGFApzyspQaMmyhyBfn8igS5EHcbuG23F', // TODO: get from config
      input.route.deposit.address,
      0.01,
    );

    await this.client.waitForTx(utxoTx);

    // 2. send accountToAccount
    const outTxId = await this.client.sendToken(
      input.route.deposit.address,
      address,
      input.asset.dexName,
      input.amount,
    );

    // 3. TODO: get rid of remaining UTXO

    return outTxId;
  }
}
