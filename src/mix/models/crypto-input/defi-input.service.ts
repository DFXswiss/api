import { AccountHistory, AccountResult } from '@defichain/jellyfish-api-core/dist/category/account';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellService } from 'src/subdomains/core/sell-crypto/sell/sell.service';
import { StakingService } from 'src/mix/models/staking/staking.service';
import { CryptoInput, CryptoInputType } from './crypto-input.entity';
import { CryptoInputRepository } from './crypto-input.repository';
import { Lock } from 'src/shared/utils/lock';
import { IsNull, Not } from 'typeorm';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { NodeNotAccessibleError } from 'src/integration/blockchain/ain/exceptions/node-not-accessible.exception';
import { CryptoInputService } from './crypto-input.service';
import { Sell } from '../../../subdomains/core/sell-crypto/sell/sell.entity';
import { Staking } from '../staking/staking.entity';
import { BuyFiatService } from '../../../subdomains/core/sell-crypto/buy-fiat/buy-fiat.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { RouteType } from '../route/deposit-route.entity';
import { Util } from 'src/shared/utils/util';
import { MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';

interface HistoryAmount {
  amount: number;
  asset: string;
  type: AssetType;
}

@Injectable()
export class DeFiInputService extends CryptoInputService {
  private readonly cryptoCryptoRouteId = 933; // TODO: fix with CryptoCrypto table
  private readonly inputLock = new Lock(43200);
  private readonly forwardingLock = new Lock(43200);

  private client: DeFiClient;

  constructor(
    nodeService: NodeService,
    cryptoInputRepo: CryptoInputRepository,
    private readonly assetService: AssetService,
    private readonly sellService: SellService,
    private readonly stakingService: StakingService,
    private readonly notificationService: NotificationService,
    private readonly buyFiatService: BuyFiatService,
  ) {
    super(cryptoInputRepo);
    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.client = client));
  }

  // --- TOKEN CONVERSION --- //
  @Interval(900000)
  async convertTokens(): Promise<void> {
    try {
      await this.checkNodeInSync(this.client);

      const tokens = await this.client.getToken();

      for (const token of tokens) {
        try {
          const { amount, asset } = this.client.parseAmount(token.amount);
          const assetEntity = await this.assetService.getAssetByQuery({
            dexName: asset,
            blockchain: Blockchain.DEFICHAIN,
            type: AssetType.TOKEN,
          });

          if (assetEntity?.category === AssetCategory.POOL_PAIR) {
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
            // ignoring dust DFI transactions
            if (asset === 'DFI' && amount < Config.blockchain.default.minTxAmount) {
              continue;
            }

            // check for min. deposit
            // TODO: remove temporary DUSD pool fix
            const usdtAmount = asset === 'DUSD' ? amount : await this.client.testCompositeSwap(asset, 'USDT', amount);
            if (usdtAmount < Config.blockchain.default.minDeposit.DeFiChain.USD * 0.4) {
              console.log('Retrieving small token:', token);

              await this.doTokenTx(
                token.owner,
                async (utxo) =>
                  await this.client.sendToken(token.owner, Config.blockchain.default.dexWalletAddress, asset, amount, [
                    utxo,
                  ]),
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
    if (!this.inputLock.acquire()) return;

    try {
      await this.saveInputs();
    } catch (e) {
      console.error('Exception during DeFiChain input checks:', e);
    } finally {
      this.inputLock.release();
    }
  }

  private async saveInputs(): Promise<void> {
    const { blocks: currentHeight } = await this.checkNodeInSync(this.client);

    // get block heights
    const lastHeight = await this.cryptoInputRepo
      .findOne({ order: { blockHeight: 'DESC' } })
      .then((input) => input?.blockHeight ?? 0);

    const utxos = await this.client.getUtxo();
    const tokens = await this.client.getToken();

    const newInputs = await this.getAddressesWithFunds(utxos, tokens)
      .then((i) => i.filter((e) => e != Config.blockchain.default.utxoSpenderAddress))
      // get receive history
      .then((a) => this.client.getHistories(a, lastHeight + 1, currentHeight))
      .then((i) => i.filter((h) => [...this.utxoTxTypes, ...this.tokenTxTypes].includes(h.type)))
      .then((i) => i.filter((h) => h.blockHeight > lastHeight))
      // map to entities
      .then((i) => this.createEntities(i))
      .then((i) => i.filter((h) => h != null));

    newInputs.length > 0 && console.log(`New DeFiChain inputs (${newInputs.length}):`, newInputs);

    // side effect, assuming that cryptoStakingRepo and stakingRepo are faultless on save
    for (const input of newInputs) {
      await this.cryptoInputRepo.save(input);

      switch (input?.type) {
        case CryptoInputType.BUY_FIAT:
          await this.buyFiatService.create(input);
          break;
        case CryptoInputType.CRYPTO_STAKING_INVALID:
          if (input.amlCheck === AmlCheck.PASS) {
            //send back
            try {
              if (input.route.user.userData.mail) {
                await this.notificationService.sendMail({
                  type: MailType.USER,
                  input: {
                    userData: input.route.user.userData,
                    translationKey: 'mail.staking.return',
                    translationParams: {
                      inputAmount: input.amount,
                      inputAsset: input.asset.name,
                      userAddressTrimmed: Util.blankBlockchainAddress(input.route.user.address),
                      transactionLink: input.inTxId,
                    },
                  },
                });
              }
            } catch (e) {
              console.error(`Failed to send staking return mail ${input.id}:`, e);
            }
          }
          break;
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
        console.error(`Failed to create DeFiChain input ${history.txid}:`, e);

        if (e instanceof NodeNotAccessibleError) {
          // abort the process until next interval cycle
          throw e;
        }
      }
    }

    return inputs;
  }

  private async createEntity(history: AccountHistory, { amount, asset, type }: HistoryAmount): Promise<CryptoInput> {
    // get asset
    const assetEntity = await this.assetService.getAssetByQuery({
      dexName: asset,
      blockchain: Blockchain.DEFICHAIN,
      type: type,
    });
    if (!assetEntity) {
      console.error(`Failed to process DeFiChain input. No asset ${asset} found. History entry:`, history);
      return null;
    }

    // only sellable
    if (!assetEntity.sellable || assetEntity.category === AssetCategory.POOL_PAIR) {
      console.log(`Ignoring unsellable DeFiChain input (${amount} ${asset}). History entry:`, history);
      return null;
    }

    const { btcAmount, usdtAmount } = await this.getReferenceAmounts(asset, amount);

    // min. deposit
    if (
      (asset === 'DFI' && amount < Config.blockchain.default.minDeposit.DeFiChain.DFI) ||
      (asset !== 'DFI' && usdtAmount < Config.blockchain.default.minDeposit.DeFiChain.USD * 0.4)
    ) {
      console.log(`Ignoring too small DeFiChain input (${amount} ${asset}). History entry:`, history);
      return null;
    }

    // get deposit route
    const route = await this.getDepositRoute(history.owner);
    if (!route) {
      console.error(
        `Failed to process DeFiChain input. No matching route for ${history.owner} found. History entry:`,
        history,
      );
      return null;
    }

    // ignore AccountToUtxos for sell
    if (route.type === RouteType.SELL && history.type === 'AccountToUtxos') {
      console.log('Ignoring AccountToUtxos DeFiChain input on sell route. History entry:', history);
      return null;
    }

    // only DFI coins for staking
    if (route.type === RouteType.STAKING && assetEntity.type !== AssetType.COIN) {
      console.log(`Ignoring non-DFI DeFiChain input (${amount} ${asset}) on staking route. History entry:`, history);
      return null;
    }

    return this.cryptoInputRepo.create({
      inTxId: history.txid,
      blockHeight: history.blockHeight,
      txType: history.type,
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
          ? CryptoInputType.CRYPTO_STAKING_INVALID
          : CryptoInputType.UNKNOWN,
    });
  }

  async getReferenceAmounts(
    asset: string,
    amount: number,
    allowRetry = true,
  ): Promise<{ btcAmount: number; usdtAmount: number }> {
    try {
      const btcAmount = await this.client.testCompositeSwap(asset, 'BTC', amount);
      // TODO: remove temporary DUSD pool fix
      const usdtAmount = asset === 'DUSD' ? amount : await this.client.testCompositeSwap(asset, 'USDT', amount);

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

  private async getDepositRoute(address: string): Promise<Sell | Staking> {
    return (
      (await this.sellService.getSellByAddress(address)) ?? (await this.stakingService.getStakingByAddress(address))
    );
  }

  // --- FORWARDING --- //
  @Interval(300000)
  async forward(): Promise<void> {
    if (!this.forwardingLock.acquire()) return;

    try {
      await this.forwardInputs();
    } catch (e) {
      console.error('Exception during DeFiChain forwarding:', e);
    } finally {
      this.forwardingLock.release();
    }
  }

  private async forwardInputs(): Promise<void> {
    const { blocks: currentHeight } = await this.checkNodeInSync(this.client);

    const inputs = await this.cryptoInputRepo.find({
      where: {
        outTxId: IsNull(),
        amlCheck: AmlCheck.PASS,
        route: { deposit: { blockchain: Blockchain.DEFICHAIN } },
      },
      relations: ['route', 'route.user'],
    });

    for (const input of inputs) {
      try {
        // only forward block rewards, which are older than 100 blocks
        if (input.txType === 'blockReward' && currentHeight <= input.blockHeight + 100) continue;

        const targetAddress =
          input.route.type === RouteType.SELL ? Config.blockchain.default.dexWalletAddress : input.route.user.address;

        input.asset.type === AssetType.COIN
          ? await this.forwardUtxo(input, targetAddress)
          : await this.forwardToken(input, targetAddress);
      } catch (e) {
        console.error(`Failed to forward DeFiChain input ${input.id}:`, e);
      }
    }
  }

  private async forwardUtxo(input: CryptoInput, address: string): Promise<void> {
    const { outTxId, feeAmount } = await this.client.sendCompleteUtxo(
      input.route.deposit.address,
      address,
      input.amount,
    );
    await this.cryptoInputRepo.update({ id: input.id }, { outTxId, forwardFeeAmount: feeAmount });
  }

  private async forwardToken(input: CryptoInput, address: string): Promise<void> {
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
  }

  // --- CONFIRMATION HANDLING --- //
  @Interval(300000)
  async checkConfirmations(): Promise<void> {
    try {
      await this.checkNodeInSync(this.client);

      const unconfirmedInputs = await this.cryptoInputRepo.find({
        select: ['id', 'outTxId', 'isConfirmed'],
        where: { isConfirmed: false, outTxId: Not(IsNull()), route: { deposit: { blockchain: Blockchain.DEFICHAIN } } },
        relations: ['route'],
      });

      for (const input of unconfirmedInputs) {
        try {
          const { confirmations } = await this.client.getTx(input.outTxId);
          if (confirmations > 60) {
            await this.cryptoInputRepo.update(input.id, { isConfirmed: true });
          }
        } catch (e) {
          console.error(`Failed to check confirmations of DeFiChain input ${input.id}:`, e);
        }
      }
    } catch (e) {
      console.error('Exception during DeFiChain confirmations checks:', e);
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
            utxo.address != Config.blockchain.default.utxoSpenderAddress &&
            utxo.amount.toNumber() < Config.blockchain.default.minDeposit.DeFiChain.DFI &&
            utxo.amount.toNumber() - this.client.utxoFee >= Config.blockchain.default.minTxAmount &&
            !utxos.find(
              (u) =>
                u.address === utxo.address && u.amount.toNumber() >= Config.blockchain.default.minDeposit.DeFiChain.DFI,
            )
          ) {
            await this.client.sendCompleteUtxo(
              utxo.address,
              Config.blockchain.default.utxoSpenderAddress,
              utxo.amount.toNumber(),
            );
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

  async getAddressesWithFunds(utxo: UTXO[], token: AccountResult<string, string>[]): Promise<string[]> {
    const utxoAddresses = utxo
      .filter((u) => u.amount.toNumber() >= Config.blockchain.default.minDeposit.DeFiChain.DFI)
      .map((u) => u.address);
    const tokenAddresses = token.map((t) => t.owner);

    return [...new Set(utxoAddresses.concat(tokenAddresses))];
  }

  private readonly utxoTxTypes = ['receive', 'AccountToUtxos', 'blockReward'];
  private readonly tokenTxTypes = [
    'AccountToAccount',
    'AnyAccountsToAccounts',
    'WithdrawFromVault',
    'PoolSwap',
    'RemovePoolLiquidity',
  ];

  getAmounts(history: AccountHistory): HistoryAmount[] {
    const amounts = this.utxoTxTypes.includes(history.type)
      ? history.amounts.map((a) => this.parseAmount(a, AssetType.COIN))
      : history.amounts.map((a) => this.parseAmount(a, AssetType.TOKEN)).filter((a) => a.amount > 0);

    return amounts.map((a) => ({ ...a, amount: Math.abs(a.amount) }));
  }

  private parseAmount(amount: string, type: AssetType): HistoryAmount {
    return { ...this.client.parseAmount(amount), type };
  }

  private async doTokenTx(addressFrom: string, tx: (utxo: UTXO) => Promise<string>): Promise<void> {
    const feeUtxo = await this.getFeeUtxo(addressFrom);
    feeUtxo ? await this.tokenTx(addressFrom, tx, feeUtxo) : void this.tokenTx(addressFrom, tx); // no waiting;
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
            u.amount.toNumber() < Config.blockchain.default.minDeposit.DeFiChain.DFI &&
            u.amount.toNumber() > Config.blockchain.default.minDeposit.DeFiChain.DFI / 4,
        ),
      );
  }

  private async sendFeeUtxo(address: string): Promise<string> {
    return await this.client.sendUtxo(
      Config.blockchain.default.utxoSpenderAddress,
      address,
      Config.blockchain.default.minDeposit.DeFiChain.DFI / 2,
    );
  }
}
