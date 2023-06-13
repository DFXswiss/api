import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config, Process } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LnurlpPaymentData } from 'src/integration/lightning/data/lnurlp-payment.data';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInRepository } from '../../../repositories/payin.repository';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class LightningStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(LightningStrategy);

  constructor(
    private readonly lightningService: LightningService,
    private readonly assetService: AssetService,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(payInRepository);
  }

  get blockchain(): Blockchain {
    return Blockchain.LIGHTNING;
  }

  async addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void> {
    for (const entry of entries) {
      try {
        const btcAmount = entry.amount;
        const usdtAmount = null;

        await this.addReferenceAmountsToEntry(entry, btcAmount, usdtAmount);
      } catch (e) {
        this.logger.error('Could not set reference amounts for Lightning pay-in:', e);
        continue;
      }
    }
  }

  doAmlCheck(_: CryptoInput, route: Staking | Sell | CryptoRoute): AmlCheck | Promise<AmlCheck> {
    return route.user.userData.kycStatus === KycStatus.REJECTED ? AmlCheck.FAIL : AmlCheck.PASS;
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();

    const lastCheckedTxId = await this.payInRepository
      .findOne({
        select: ['inTxId'],
        where: { address: { blockchain: this.blockchain } },
        order: { id: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.inTxId ?? '');

    const newEntries = await this.getNewEntries(lastCheckedTxId);

    await this.addReferenceAmounts(newEntries);

    await this.createPayInsAndSave(newEntries, log);

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  private async getNewEntries(lastCheckedTxId: string): Promise<PayInEntry[]> {
    const payments = await this.lightningService.getDefaultClient().getLnurlpPayments(lastCheckedTxId);
    return this.mapToPayInEntries(payments);
  }

  private async mapToPayInEntries(payments: LnurlpPaymentData[]): Promise<PayInEntry[]> {
    const asset = await this.assetService.getLightningCoin();

    return [...payments].reverse().map((p) => ({
      address: BlockchainAddress.create(this.getAddress(p), this.blockchain),
      txId: p.paymentDto.checking_id,
      txType: null,
      blockHeight: null,
      amount: p.paymentDto.amount / 10 ** 3 / 10 ** 8,
      asset,
    }));
  }

  private getAddress(paymentData: LnurlpPaymentData): string {
    return paymentData.lnurl ? paymentData.lnurl : null;
  }
}
