import { AccountHistory, AccountResult } from '@defichain/jellyfish-api-core/dist/category/account';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
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
import { Not } from 'typeorm';

interface HistoryAmount {
  amount: number;
  asset: string;
  isToken: boolean;
}

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

  @Interval(900000)
  async removePoolLiquidities(): Promise<void> {
    try {
      await this.checkNodeInSync();

      const tokens = await this.client.getToken();
      for (const token of tokens) {
        const { asset } = this.client.parseAmount(token.amount);
        const assetEntity = await this.assetService.getAssetByDexName(asset);

        if (assetEntity?.isLP) {
          this.removePoolLiquidity(token); // no waiting
        }
      }
    } catch (e) {
      console.error('Exception during liquidity pool removal:', e);
    }
  }

  @Interval(300000)
  async checkInputs(): Promise<void> {
    // avoid overlaps
    if (!this.lock.acquire()) return;

    try {
      const { blocks: currentHeight } = await this.checkNodeInSync();

      // get block heights
      const lastHeight = await this.cryptoInputRepo
        .findOne({ order: { blockHeight: 'DESC' } })
        .then((input) => input?.blockHeight ?? 0);

      const newInputs = await this.client
        .getAddressesWithFunds()
        .then((i) => i.filter((e) => e != Config.node.utxoSpenderAddress))
        // get receive history
        .then((a) => this.client.getHistories(a, lastHeight + 1, currentHeight))
        .then((i) => i.filter((h) => [...this.utxoTxTypes, ...this.tokenTxTypes].includes(h.type)))
        .then((i) => i.filter((h) => h.blockHeight > lastHeight))
        // map to entities
        .then((i) => this.createEntities(i))
        .then((i) => i.filter((h) => h != null));

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

  @Interval(300000)
  async checkConfirmations(): Promise<void> {
    try {
      await this.checkNodeInSync();

      const unconfirmedInputs = await this.cryptoInputRepo.find({
        select: ['id', 'outTxId', 'isConfirmed'],
        where: { isConfirmed: false, outTxId: Not('') },
      });

      for (const input of unconfirmedInputs) {
        try {
          const { confirmations } = await this.client.waitForTx(input.outTxId);
          if (confirmations > 60) {
            await this.cryptoInputRepo.update(input.id, { isConfirmed: true });
          }
        } catch (e) {
          console.error(`Failed to check confirmations of crypto input ${input.id}:`, e);
        }
      }
    } catch (e) {
      console.error('Exception during crypto confirmations checks:', e);
    }
  }

  // --- HELPER METHODS --- //
  private async checkNodeInSync(): Promise<{ headers: number; blocks: number }> {
    const { blocks, headers } = await this.client.getInfo();
    if (blocks < headers) throw new Error(`Node not in sync by ${headers - blocks} block(s)`);

    return { headers, blocks };
  }

  private async createEntities(histories: AccountHistory[]): Promise<CryptoInput[]> {
    const inputs = [];
    for (const history of histories) {
      try {
        const amounts = this.getAmounts(history);
        for (const amount of amounts) {
          inputs.push(await this.createEntity(history, amount));
        }
      } catch (e) {
        console.error(`Failed to process crypto input ${history.txid}:`, e);
      }
    }
    return inputs;
  }

  private readonly utxoTxTypes = ['receive', 'AccountToUtxos'];
  private readonly tokenTxTypes = ['AccountToAccount', 'WithdrawFromVault', 'PoolSwap', 'RemovePoolLiquidity'];

  getAmounts(history: AccountHistory): HistoryAmount[] {
    const amounts = this.utxoTxTypes.includes(history.type)
      ? history.amounts.map((a) => this.parseAmount(a, false))
      : history.amounts.map((a) => this.parseAmount(a, true)).filter((a) => a.amount > 0);

    return amounts.map((a) => ({ ...a, amount: Math.abs(a.amount) }));
  }

  private parseAmount(amount: string, isToken: boolean): HistoryAmount {
    return { ...this.client.parseAmount(amount), isToken };
  }

  private async createEntity(history: AccountHistory, { amount, asset, isToken }: HistoryAmount): Promise<CryptoInput> {
    // get asset
    const assetEntity = await this.assetService.getAssetByDexName(asset, isToken);
    if (!assetEntity) {
      console.error(`Failed to process crypto input. No asset ${asset} found. History entry:`, history);
      return null;
    }

    // only sellable
    if (!assetEntity.sellable) {
      console.log(`Ignoring unsellable crypto input (${amount} ${asset}). History entry:`, history);
      return null;
    }

    const btcAmount = await this.client.testCompositeSwap(history.owner, asset, 'BTC', amount);
    const usdtAmount = await this.client.testCompositeSwap(history.owner, asset, 'USDT', amount);

    // min. deposit
    if (
      (asset === 'DFI' && amount < Config.node.minDfiDeposit) ||
      (asset !== 'DFI' && usdtAmount < Config.node.minTokenDeposit)
    ) {
      console.log(`Ignoring too small crypto input (${amount} ${asset}). History entry:`, history);
      return null;
    }

    // get deposit route
    const route =
      (await this.sellService.getSellByAddress(history.owner)) ??
      (await this.stakingService.getStakingByAddress(history.owner));
    if (!route) {
      console.error(
        `Failed to process crypto input. No matching route for ${history.owner} found. History entry:`,
        history,
      );
      return null;
    }

    // ignore AccountToUtxos for sell
    if (route.type === RouteType.SELL && history.type === 'AccountToUtxos') {
      console.log('Ignoring AccountToUtxos crypto input on sell route. History entry:', history);
      return null;
    }

    // only DFI for staking
    if (route.type === RouteType.STAKING && assetEntity.name != 'DFI') {
      console.log(`Ignoring non-DFI crypto input (${amount} ${asset}) on staking route. History entry:`, history);
      return null;
    }

    return this.cryptoInputRepo.create({
      inTxId: history.txid,
      outTxId: '', // will be set after crypto forward
      blockHeight: history.blockHeight,
      amount: amount,
      asset: assetEntity,
      route: route,
      btcAmount: btcAmount,
      usdtAmount: usdtAmount,
      isConfirmed: false,
    });
  }

  private async saveAndForward(input: CryptoInput): Promise<void> {
    try {
      // save
      await this.cryptoInputRepo.save(input);
      if (input.route.type === RouteType.STAKING) {
        await this.stakingService.updateBalance(input.route.id);
      }

      // forward (only await UTXO)
      const targetAddress =
        input.route.type === RouteType.SELL ? Config.node.dexWalletAddress : Config.node.stakingWalletAddress;
      input.asset.type === AssetType.COIN
        ? await this.forwardUtxo(input, targetAddress)
        : this.forwardToken(input, targetAddress); // no waiting
    } catch (e) {
      console.error(`Failed to process crypto input:`, e);
    }
  }

  private async forwardUtxo(input: CryptoInput, address: string): Promise<void> {
    const outTxId = await this.client.sendUtxo(input.route.deposit.address, address, input.amount);
    await this.cryptoInputRepo.update({ id: input.id }, { outTxId });
  }

  private async forwardToken(input: CryptoInput, address: string): Promise<void> {
    try {
      await this.doTokenTx(input.route.deposit.address, async (utxo) => {
        const outTxId = await this.client.sendToken(
          input.route.deposit.address,
          address,
          input.asset.dexName,
          input.amount,
          [utxo],
        );
        await this.cryptoInputRepo.update({ id: input.id }, { outTxId });

        return outTxId;
      });
    } catch (e) {
      console.error(`Failed to forward token input:`, e);
    }
  }

  private async removePoolLiquidity(token: AccountResult<string, string>): Promise<void> {
    try {
      console.log('Removing pool liquidity:', token);
      await this.doTokenTx(token.owner, (utxo) => this.client.removePoolLiquidity(token.owner, token.amount, [utxo]));
    } catch (e) {
      console.error('Failed to remove pool liquidity', e);
    }
  }

  private async doTokenTx(address: string, tx: (utxo: UTXO) => Promise<string>): Promise<void> {
    // get UTXO
    const utxoTx = await this.client.sendUtxo(Config.node.utxoSpenderAddress, address, Config.node.minDfiDeposit / 2);

    await this.client.waitForTx(utxoTx);

    // get UTXO vout
    const sendUtxo = await this.client
      .getUtxo()
      .then((utxos) => utxos.find((u) => u.txid === utxoTx && u.address == address));

    // do TX
    const outTxId = await tx(sendUtxo);

    await this.client.waitForTx(outTxId);

    // retrieve remaining UTXO
    const utxo = await this.client.getUtxo().then((utxo) => utxo.find((u) => u.txid === outTxId));
    if (utxo) {
      await this.client.sendUtxo(utxo.address, Config.node.utxoSpenderAddress, utxo.amount.toNumber());
    } else {
      console.error(`Could not retrieve UTXO: UTXO ${outTxId} not found`);
    }
  }
}
