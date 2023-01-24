import {
  AccountHistory as JellyAccountHistory,
  AccountResult,
} from '@defichain/jellyfish-api-core/dist/category/account';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { RouteType } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInRepository } from '../repositories/payin.repository';
import { PayInJellyfishService } from './base/payin-jellyfish.service';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { StakingService } from 'src/subdomains/core/staking/services/staking.service';
import { Interval } from '@nestjs/schedule';

interface HistoryAmount {
  amount: number;
  asset: string;
}

export type AccountHistory = Omit<JellyAccountHistory & HistoryAmount & { assetType: AssetType }, 'amounts'>;

@Injectable()
export class PayInDeFiChainService extends PayInJellyfishService {
  private client: DeFiClient;

  private readonly utxoTxTypes = ['receive', 'AccountToUtxos'];
  private readonly tokenTxTypes = [
    'AccountToAccount',
    'AnyAccountsToAccounts',
    'WithdrawFromVault',
    'PoolSwap',
    'RemovePoolLiquidity',
  ];

  constructor(
    private readonly assetService: AssetService,
    private readonly sellService: SellService,
    @Inject(forwardRef(() => StakingService))
    private readonly stakingService: StakingService,
    protected readonly payInRepo: PayInRepository,
    nodeService: NodeService,
  ) {
    super();
    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.client = client));
  }

  async checkHealthOrThrow(): Promise<void> {
    await this.checkNodeInSync(this.client);
  }

  async getNewTransactionsHistorySince(lastHeight: number): Promise<AccountHistory[]> {
    const { blocks: currentHeight } = await this.client.checkSync();

    const utxos = await this.client.getUtxo();
    const tokens = await this.client.getToken();

    return (
      this.getAddressesWithFunds(utxos, tokens)
        .then((i) => i.filter((e) => e != Config.blockchain.default.utxoSpenderAddress))
        // get receive history
        .then((a) => this.client.getHistories(a, lastHeight + 1, currentHeight))
        .then((i) => i.filter((h) => [...this.utxoTxTypes, ...this.tokenTxTypes].includes(h.type)))
        .then((i) => i.filter((h) => h.blockHeight > lastHeight))
        .then((i) => this.splitHistories(i))
        .then((i) => i.filter((a) => this.isDFI(a) || this.isDUSD(a)))
        .then((i) => i.map((a) => ({ ...a, amount: Math.abs(a.amount) })))
    );
  }

  async sendUtxo(input: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    return this.client.sendCompleteUtxo(input.address.address, input.destinationAddress.address, input.amount);
  }

  async sendToken(input: CryptoInput, action: (outTxId: string) => CryptoInput): Promise<void> {
    await this.doTokenTx(input.address.address, async (utxo) => {
      const outTxId = await this.client.sendToken(
        input.address.address,
        input.destinationAddress.address,
        input.asset.dexName,
        input.amount,
        [utxo],
      );

      const updatedInput = action(outTxId);
      await this.payInRepo.save(updatedInput);

      return outTxId;
    });
  }

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

  //*** HELPER METHODS ***//

  async getAddressesWithFunds(utxo: UTXO[], token: AccountResult<string, string>[]): Promise<string[]> {
    const utxoAddresses = utxo
      .filter((u) => u.amount.toNumber() >= Config.blockchain.default.minDeposit.DeFiChain.DFI)
      .map((u) => u.address);
    const tokenAddresses = token.map((t) => t.owner);

    return [...new Set(utxoAddresses.concat(tokenAddresses))];
  }

  // TODO -> why do we need this?
  private splitHistories(histories: JellyAccountHistory[]): AccountHistory[] {
    return histories
      .map((h) => h.amounts.map((a) => ({ ...h, ...this.parseAmount(a), assetType: this.getAssetType(h) })))
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private getAssetType(history: JellyAccountHistory): AssetType | undefined {
    if (this.utxoTxTypes.includes(history.type)) return AssetType.COIN;
    if (this.tokenTxTypes.includes(history.type)) return AssetType.TOKEN;
  }

  private isDFI(history: AccountHistory): boolean {
    return (
      history.assetType === AssetType.COIN &&
      history.asset === 'DFI' &&
      Math.abs(history.amount) >= Config.payIn.min.DeFiChain.DFI
    );
  }

  private isDUSD(history: AccountHistory): boolean {
    return (
      history.assetType === AssetType.TOKEN &&
      history.asset === 'DUSD' &&
      history.amount >= Config.payIn.min.DeFiChain.DUSD
    );
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

  private parseAmount(amount: string): HistoryAmount {
    return { ...this.client.parseAmount(amount) };
  }

  private async getDepositRoute(address: string): Promise<Sell | Staking> {
    return (
      (await this.sellService.getSellByAddress(address)) ?? (await this.stakingService.getStakingByAddress(address))
    );
  }
}
