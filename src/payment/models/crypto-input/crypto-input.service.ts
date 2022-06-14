import { AccountHistory, AccountResult } from '@defichain/jellyfish-api-core/dist/category/account';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RouteType } from 'src/payment/models/route/deposit-route.entity';
import { SellService } from 'src/payment/models/sell/sell.service';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { CryptoInput, CryptoInputType } from './crypto-input.entity';
import { CryptoInputRepository } from './crypto-input.repository';
import { Lock } from 'src/shared/lock';
import { In, Not } from 'typeorm';
import { Sell } from '../sell/sell.entity';
import { Staking } from '../staking/staking.entity';
import { CryptoStakingService } from '../crypto-staking/crypto-staking.service';
import { UpdateCryptoInputDto } from './dto/update-crypto-input.dto';
import { KycStatus } from 'src/user/models/user-data/user-data.entity';
import { AmlCheck } from '../buy-crypto/buy-crypto.entity';
import { NodeNotAccessibleError } from 'src/payment/exceptions/node-not-accessible.exception';

interface HistoryAmount {
  amount: number;
  asset: string;
  isToken: boolean;
}

@Injectable()
export class CryptoInputService {
  private readonly cryptoCryptoRouteId = 933; // TODO: fix with CryptoCrypto table
  private readonly lock = new Lock(1800);

  private client: NodeClient;

  constructor(
    nodeService: NodeService,
    private readonly cryptoInputRepo: CryptoInputRepository,
    private readonly assetService: AssetService,
    private readonly sellService: SellService,
    private readonly stakingService: StakingService,
    private readonly cryptoStakingService: CryptoStakingService,
  ) {
    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.client = client));
  }

  async update(cryptoInputId: number, dto: UpdateCryptoInputDto): Promise<CryptoInput> {
    const cryptoInput = await this.cryptoInputRepo.findOne(cryptoInputId);
    if (!cryptoInput) throw new NotFoundException('CryptoInput not found');

    return await this.cryptoInputRepo.save({ ...cryptoInput, ...dto });
  }

  async getAllUserTransactions(userIds: number[]): Promise<CryptoInput[]> {
    return await this.cryptoInputRepo.find({
      where: { route: { user: { id: In(userIds) } } },
      relations: ['cryptoSell', 'cryptoStaking', 'route', 'route.user'],
    });
  }

  // --- TOKEN CONVERSION --- //
  @Interval(900000)
  async convertTokens(): Promise<void> {
    try {
      await this.checkNodeInSync();

      const tokens = await this.client.getToken();

      for (const token of tokens) {
        try {
          const { amount, asset } = this.client.parseAmount(token.amount);
          const assetEntity = await this.assetService.getAssetByDexName(asset, true);

          if (assetEntity?.isLP) {
            console.log('Removing pool liquidity:', token);

            // remove pool liquidity
            await this.doTokenTx(token.owner, (utxo) =>
              this.client.removePoolLiquidity(token.owner, token.amount, [utxo]),
            );

            // send UTXO (for second token)
            const additionalFeeUtxo = await this.getFeeUtxo(token.owner);
            if (!additionalFeeUtxo) {
              await this.sendFeeUtxo(token.owner);
            }
          } else {
            // check for min. deposit
            const usdtAmount = await this.client.testCompositeSwap(asset, 'USDT', amount);
            if (usdtAmount < Config.node.minTokenDeposit) {
              console.log('Retrieving small token:', token);

              await this.doTokenTx(
                token.owner,
                async (utxo) =>
                  await this.client.sendToken(token.owner, Config.node.dexWalletAddress, asset, amount, [utxo]),
              );
            } else {
              const route = await this.getDepositRoute(token.owner);
              if (route?.type === RouteType.STAKING) {
                console.log('Doing token conversion:', token);

                if (asset === 'DFI') {
                  // to UTXO
                  await this.doTokenTx(token.owner, async (utxo) =>
                    this.client.toUtxo(token.owner, token.owner, amount, [utxo]),
                  );
                } else {
                  // to DFI
                  await this.doTokenTx(token.owner, async (utxo) =>
                    this.client.compositeSwap(token.owner, asset, token.owner, 'DFI', amount, [utxo]),
                  );
                }
              }
            }
          }
        } catch (e) {
          console.error(`Failed to convert token (${token.amount} on ${token.owner}):`, e);
        }
      }
    } catch (e) {
      console.error('Exception during token conversion:', e);
    }
  }

  // --- INPUT HANDLING --- //
  @Interval(300000)
  async checkInputs(): Promise<void> {
    if (!this.lock.acquire()) return;

    try {
      await this.saveInputs();
      await this.forwardInputs();
    } catch (e) {
      console.error('Exception during crypto input checks:', e);
    } finally {
      this.lock.release();
    }
  }

  private async saveInputs(): Promise<void> {
    const { blocks: currentHeight } = await this.checkNodeInSync();

    // get block heights
    const lastHeight = await this.cryptoInputRepo
      .findOne({ order: { blockHeight: 'DESC' } })
      .then((input) => input?.blockHeight ?? 0);

    const utxos = await this.client.getUtxo();
    const tokens = await this.client.getToken();

    const newInputs = await this.getAddressesWithFunds(utxos, tokens)
      .then((i) => i.filter((e) => e != Config.node.utxoSpenderAddress))
      // get receive history
      .then((a) => this.client.getHistories(a, lastHeight + 1, currentHeight))
      .then((i) => i.filter((h) => [...this.utxoTxTypes, ...this.tokenTxTypes].includes(h.type)))
      .then((i) => i.filter((h) => h.blockHeight > lastHeight))
      // map to entities
      .then((i) => this.createEntities(i))
      .then((i) => i.filter((h) => h != null))
      // check required balance
      .then((i) => i.filter((h) => this.hasMatchingBalance(h, utxos, tokens)));

    newInputs.length > 0 && console.log(`New crypto inputs (${newInputs.length}):`, newInputs);

    // side effect, assuming that cryptoStakingRepo and stakingRepo are faultless on save
    for (const input of newInputs) {
      await this.cryptoInputRepo.save(input);
      if (input?.route.type === RouteType.STAKING) {
        await this.cryptoStakingService.create(input);
      }
    }
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
        console.error(`Failed to create crypto input ${history.txid}:`, e);

        if (e instanceof NodeNotAccessibleError) {
          // abort the process until next interval cycle
          throw e;
        }
      }
    }

    return inputs;
  }

  private async createEntity(history: AccountHistory, { amount, asset, isToken }: HistoryAmount): Promise<CryptoInput> {
    // get asset
    const assetEntity = await this.assetService.getAssetByDexName(asset, isToken);
    if (!assetEntity) {
      console.error(`Failed to process crypto input. No asset ${asset} found. History entry:`, history);
      return null;
    }

    // only sellable
    if (!assetEntity.sellable || assetEntity.isLP) {
      console.log(`Ignoring unsellable crypto input (${amount} ${asset}). History entry:`, history);
      return null;
    }

    const { btcAmount, usdtAmount } = await this.getReferenceAmounts(asset, amount);

    // min. deposit
    if (
      (asset === 'DFI' && amount < Config.node.minDfiDeposit) ||
      (asset !== 'DFI' && usdtAmount < Config.node.minTokenDeposit)
    ) {
      console.log(`Ignoring too small crypto input (${amount} ${asset}). History entry:`, history);
      return null;
    }

    // get deposit route
    const route = await this.getDepositRoute(history.owner);
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
      amlCheck: route.user.userData.kycStatus === KycStatus.REJECTED ? AmlCheck.FAIL : AmlCheck.PASS,
      type:
        route.type === RouteType.SELL
          ? route.id == this.cryptoCryptoRouteId
            ? CryptoInputType.CRYPTO_CRYPTO
            : CryptoInputType.BUY_FIAT
          : route.type === RouteType.STAKING
          ? CryptoInputType.CRYPTO_STAKING
          : CryptoInputType.UNKNOWN,
    });
  }

  private async getReferenceAmounts(
    asset: string,
    amount: number,
    allowRetry = true,
  ): Promise<{ btcAmount: number; usdtAmount: number }> {
    try {
      const btcAmount = await this.client.testCompositeSwap(asset, 'BTC', amount);
      const usdtAmount = await this.client.testCompositeSwap(asset, 'USDT', amount);

      return { btcAmount, usdtAmount };
    } catch (e) {
      try {
        // poll the node
        await this.client.getInfo();
      } catch (nodeError) {
        throw new NodeNotAccessibleError(NodeType.INPUT, nodeError);
      }

      if (allowRetry) {
        // try once again
        console.log('Retrying testCompositeSwaps after node poll success');
        return await this.getReferenceAmounts(asset, amount, false);
      }

      // re-throw error, likely input related
      throw e;
    }
  }

  private async forwardInputs(): Promise<void> {
    const inputs = await this.cryptoInputRepo.find({
      where: { outTxId: '', amlCheck: AmlCheck.PASS },
      relations: ['route'],
    });

    inputs.length > 0 && console.log(`Forwarding inputs (${inputs.length})`);

    for (const input of inputs) {
      try {
        const targetAddress =
          input.route.type === RouteType.SELL ? Config.node.dexWalletAddress : Config.node.stakingWalletAddress;

        input.asset.type === AssetType.COIN
          ? await this.forwardUtxo(input, targetAddress)
          : await this.forwardToken(input, targetAddress);
      } catch (e) {
        console.error(`Failed to forward crypto input ${input.id}:`, e);
      }
    }
  }

  private async forwardUtxo(input: CryptoInput, address: string): Promise<void> {
    const outTxId = await this.client.sendUtxo(input.route.deposit.address, address, input.amount);
    await this.cryptoInputRepo.update({ id: input.id }, { outTxId });
  }

  private async forwardToken(input: CryptoInput, address: string): Promise<void> {
    await this.doTokenTx(input.route.deposit.address, async (utxo) => {
      const outTxId = await this.client.sendToken(
        input.route.deposit.address,
        address,
        input.asset.dexName.replace('-Token', ''),
        input.amount,
        [utxo],
      );
      await this.cryptoInputRepo.update({ id: input.id }, { outTxId });

      return outTxId;
    });
  }

  // --- CONFIRMATION HANDLING --- //
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

  // --- FEE UTXO RETRIEVAL --- //
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async retrieveFeeUtxos(): Promise<void> {
    try {
      const utxos = await this.client.getUtxo();

      for (const utxo of utxos) {
        try {
          if (
            utxo.address != Config.node.utxoSpenderAddress &&
            utxo.amount.toNumber() < Config.node.minDfiDeposit &&
            utxo.amount.toNumber() - this.client.utxoFee >= Config.node.minTxAmount &&
            !utxos.find((u) => u.address === utxo.address && u.amount.toNumber() >= Config.node.minDfiDeposit)
          ) {
            await this.client.sendCompleteUtxo(utxo.address, Config.node.utxoSpenderAddress, utxo.amount.toNumber());
          }
        } catch (e) {
          console.log('Failed to retrieve fee UTXO:', e);
        }
      }
    } catch (e) {
      console.error('Exception during fee UTXO retrieval:', e);
    }
  }

  // --- HELPER METHODS --- //
  private async checkNodeInSync(): Promise<{ headers: number; blocks: number }> {
    const { blocks, headers } = await this.client.getInfo();
    if (blocks < headers - 1) throw new Error(`Node not in sync by ${headers - blocks} block(s)`);

    return { headers, blocks };
  }

  async getAddressesWithFunds(utxo: UTXO[], token: AccountResult<string, string>[]): Promise<string[]> {
    const utxoAddresses = utxo.filter((u) => u.amount.toNumber() >= Config.node.minDfiDeposit).map((u) => u.address);
    const tokenAddresses = token.map((t) => t.owner);

    return [...new Set(utxoAddresses.concat(tokenAddresses))];
  }

  private readonly utxoTxTypes = ['receive', 'AccountToUtxos'];
  private readonly tokenTxTypes = [
    'AccountToAccount',
    'AnyAccountsToAccounts',
    'WithdrawFromVault',
    'PoolSwap',
    'RemovePoolLiquidity',
  ];

  getAmounts(history: AccountHistory): HistoryAmount[] {
    const amounts = this.utxoTxTypes.includes(history.type)
      ? history.amounts.map((a) => this.parseAmount(a, false))
      : history.amounts.map((a) => this.parseAmount(a, true)).filter((a) => a.amount > 0);

    return amounts.map((a) => ({ ...a, amount: Math.abs(a.amount) }));
  }

  private parseAmount(amount: string, isToken: boolean): HistoryAmount {
    return { ...this.client.parseAmount(amount), isToken };
  }

  private async doTokenTx(addressFrom: string, tx: (utxo: UTXO) => Promise<string>): Promise<void> {
    const feeUtxo = await this.getFeeUtxo(addressFrom);
    feeUtxo ? await this.tokenTx(addressFrom, tx, feeUtxo) : this.tokenTx(addressFrom, tx); // no waiting;
  }

  private async tokenTx(addressFrom: string, tx: (utxo: UTXO) => Promise<string>, feeUtxo?: UTXO): Promise<void> {
    try {
      // get UTXO
      if (!feeUtxo) {
        const utxoTx = await this.sendFeeUtxo(addressFrom);
        await this.client.waitForTx(utxoTx);
        feeUtxo = await this.client
          .getUtxo()
          .then((utxos) => utxos.find((u) => u.txid === utxoTx && u.address === addressFrom));
      }

      // do TX
      await tx(feeUtxo);
    } catch (e) {
      console.error('Failed to do token TX:', e);
    }
  }

  private async getFeeUtxo(address: string): Promise<UTXO | undefined> {
    return await this.client
      .getUtxo()
      .then((utxos) =>
        utxos.find(
          (u) =>
            u.address === address &&
            u.amount.toNumber() < Config.node.minDfiDeposit &&
            u.amount.toNumber() > Config.node.minDfiDeposit / 4,
        ),
      );
  }

  private async sendFeeUtxo(address: string): Promise<string> {
    return await this.client.sendUtxo(Config.node.utxoSpenderAddress, address, Config.node.minDfiDeposit / 2);
  }

  private async getDepositRoute(address: string): Promise<Sell | Staking> {
    return (
      (await this.sellService.getSellByAddress(address)) ?? (await this.stakingService.getStakingByAddress(address))
    );
  }

  private hasMatchingBalance(input: CryptoInput, utxo: UTXO[], token: AccountResult<string, string>[]): boolean {
    const fund =
      input.asset.type === AssetType.COIN
        ? utxo.find((u) => u.address === input.route.deposit.address && u.amount.toNumber() >= input.amount)
        : token.find(
            (t) => t.owner === input.route.deposit.address && this.client.parseAmount(t.amount).amount >= input.amount,
          );
    if (!fund) {
      console.error('Ignoring input due to too low balance:', input);
    }

    return fund != null;
  }
}
