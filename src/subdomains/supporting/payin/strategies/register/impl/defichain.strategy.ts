import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Config, Process } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayInEntry } from '../../../interfaces';
import { PayInRepository } from '../../../repositories/payin.repository';
import { RegisterStrategy } from './base/register.strategy';
import { PayInFactory } from '../../../factories/payin.factory';
import { HistoryAmount, PayInDeFiChainService } from '../../../services/payin-defichain.service';
import { PayInService } from '../../../services/payin.service';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';

@Injectable()
export class DeFiChainStrategy extends RegisterStrategy {
  constructor(
    private readonly assetService: AssetService,
    private readonly deFiChainService: PayInDeFiChainService,
    protected readonly dexService: DexService,
    @Inject(forwardRef(() => PayInService))
    protected readonly payInService: PayInService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(dexService, payInFactory, payInRepository);
  }

  //*** PUBLIC API ***//

  doAmlCheck(_: CryptoInput, route: Staking | Sell | CryptoRoute): AmlCheck {
    return route.user.userData.kycStatus === KycStatus.REJECTED ? AmlCheck.FAIL : AmlCheck.PASS;
  }

  /**
   * @note
   * accepting CryptoInput (PayIn) entities for retry mechanism (see PayInService -> #retryGettingReferencePrices())
   */
  async addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void> {
    const btc = await this.assetService.getAssetByQuery({
      dexName: 'BTC',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    const usdt = await this.assetService.getAssetByQuery({
      dexName: 'USDT',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    for (const entry of entries) {
      try {
        const btcAmount = await this.getReferenceAmount(entry.asset, entry.amount, btc);
        const usdtAmount = await this.getReferenceAmount(entry.asset, entry.amount, usdt);

        await this.addReferenceAmountsToEntry(entry, btcAmount, usdtAmount);
      } catch (e) {
        console.error('Could not set reference amounts for DeFiChain pay-in', e);
        continue;
      }
    }
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  @Lock(7200)
  async splitPools(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;

    await this.deFiChainService.splitPools();
  }

  @Cron(CronExpression.EVERY_HOUR)
  @Lock(7200)
  async retrieveSmallDfiTokens(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;

    await this.deFiChainService.retrieveSmallDfiTokens();
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  @Lock(7200)
  async retrieveFeeUtxos(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;

    await this.deFiChainService.retrieveFeeUtxos();
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const lastCheckedBlockHeight = await this.payInRepository
      .findOne({
        select: ['id', 'blockHeight'],
        where: { address: { blockchain: Blockchain.DEFICHAIN } },
        order: { blockHeight: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.blockHeight ?? 0);

    const newEntries = await this.getNewEntriesSince(lastCheckedBlockHeight);
    await this.addReferenceAmounts(newEntries);

    await this.createPayInsAndSave(newEntries, log);

    this.printInputLog(log, lastCheckedBlockHeight, Blockchain.DEFICHAIN);
  }

  private async getNewEntriesSince(lastHeight: number): Promise<PayInEntry[]> {
    const supportedAssets = await this.assetService.getAllAsset([Blockchain.DEFICHAIN]);
    const histories = await this.deFiChainService.getNewTransactionsHistorySince(lastHeight);

    return this.mapHistoriesToEntries(histories, supportedAssets);
  }

  private mapHistoriesToEntries(histories: AccountHistory[], supportedAssets: Asset[]): PayInEntry[] {
    const inputs = [];

    for (const history of histories) {
      try {
        const amounts = this.deFiChainService.getAmounts(history);
        for (const amount of amounts) {
          inputs.push(this.createEntry(history, amount, supportedAssets));
        }
      } catch (e) {
        console.error(`Failed to create DeFiChain input ${history.txid}:`, e);
      }
    }

    return inputs.map((h) => this.filterOutInvalid(h)).filter((p) => p != null);
  }

  private filterOutInvalid(_entry: PayInEntry): PayInEntry | null {
    let entry: PayInEntry | null = _entry;

    entry = this.filterOutPoolPairs(entry);
    entry = this.filterOutTooSmall(entry);

    return entry;
  }

  private filterOutTooSmall(p: PayInEntry): PayInEntry | null {
    if (p == null) return null;

    if (p.asset && p.asset.dexName === 'DFI' && p.amount < Config.payIn.minDeposit.DeFiChain.DFI) {
      console.log(`Ignoring too small DeFiChain input (${p.amount} ${p.asset.dexName}). PayIn entry:`, p);
      return null;
    }

    return p;
  }

  private createEntry(
    history: AccountHistory,
    { amount, asset, type }: HistoryAmount,
    supportedAssets: Asset[],
  ): PayInEntry {
    return {
      address: BlockchainAddress.create(history.owner, Blockchain.DEFICHAIN),
      txId: history.txid,
      txType: history.type,
      blockHeight: history.blockHeight,
      amount: amount,
      asset:
        this.assetService.getByQuerySync(supportedAssets, { dexName: asset, type, blockchain: Blockchain.DEFICHAIN }) ??
        null,
    };
  }
}
