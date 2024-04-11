import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LnurlpPaymentData } from 'src/integration/lightning/data/lnurlp-payment.data';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class LightningStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(LightningStrategy);

  constructor(private readonly lightningService: LightningService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.LIGHTNING;
  }

  doAmlCheck(_: CryptoInput, route: Staking | Sell | Swap): CheckStatus | Promise<CheckStatus> {
    return route.user.userData.kycLevel === KycLevel.REJECTED ? CheckStatus.FAIL : CheckStatus.PASS;
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (DisabledProcess(Process.PAY_IN)) return;

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
      amount: LightningHelper.msatToBtc(p.paymentDto.amount),
      asset,
    }));
  }

  private getAddress(paymentData: LnurlpPaymentData): string {
    return paymentData.lnurl ? paymentData.lnurl : null;
  }
}
