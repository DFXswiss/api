import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { PayoutFrequency } from 'src/subdomains/core/payment-link/entities/payment-link.config';
import { PayInStatus } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { In, IsNull } from 'typeorm';
import { FiatOutputService } from '../../../../supporting/fiat-output/fiat-output.service';
import { CheckStatus } from '../../../aml/enums/check-status.enum';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatPreparationService } from './buy-fiat-preparation.service';
import { BuyFiatRegistrationService } from './buy-fiat-registration.service';

@Injectable()
export class BuyFiatJobService {
  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly buyFiatRegistrationService: BuyFiatRegistrationService,
    private readonly fiatOutputService: FiatOutputService,
    private readonly buyFiatPreparationService: BuyFiatPreparationService,
  ) {}

  // --- CHECK BUY FIAT --- //
  @Cron(CronExpression.EVERY_10_MINUTES)
  @Lock(7200)
  async addFiatOutputs(): Promise<void> {
    if (DisabledProcess(Process.BUY_FIAT)) return;

    const buyFiatsWithoutOutput = await this.buyFiatRepo.find({
      relations: { fiatOutput: true, sell: true, transaction: { user: { userData: true } }, cryptoInput: true },
      where: {
        amlCheck: CheckStatus.PASS,
        fiatOutput: IsNull(),
        cryptoInput: { status: In([PayInStatus.FORWARD_CONFIRMED, PayInStatus.COMPLETED]) },
      },
    });

    // immediate payouts
    const immediateOutputs = buyFiatsWithoutOutput.filter(
      (bf) =>
        !bf.userData.paymentLinksConfigObj.payoutFrequency ||
        bf.userData.paymentLinksConfigObj.payoutFrequency === PayoutFrequency.IMMEDIATE,
    );

    for (const buyFiat of immediateOutputs) {
      await this.fiatOutputService.createInternal('BuyFiat', { buyFiats: [buyFiat] });
    }

    // daily payouts
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const dailyOutputs = buyFiatsWithoutOutput.filter(
      (bf) => bf.userData.paymentLinksConfigObj.payoutFrequency === PayoutFrequency.DAILY && bf.created < startOfDay,
    );
    const sellGroups = Util.groupByAccessor(dailyOutputs, (bf) => bf.sell.id);

    for (const buyFiats of sellGroups.values()) {
      await this.fiatOutputService.createInternal(
        'BuyFiat',
        { buyFiats },
        buyFiats[0].userData.paymentLinksConfigObj.ep2ReportContainer != null,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async checkCryptoPayIn() {
    if (DisabledProcess(Process.BUY_FIAT)) return;
    await this.buyFiatRegistrationService.registerSellPayIn();
    await this.buyFiatRegistrationService.syncReturnTxId();
    if (!DisabledProcess(Process.AUTO_AML_CHECK)) await this.buyFiatPreparationService.doAmlCheck();
    if (!DisabledProcess(Process.BUY_FIAT_SET_FEE)) {
      await this.buyFiatPreparationService.refreshFee();
      await this.buyFiatPreparationService.fillPaymentLinkPayments();
    }
    await this.buyFiatPreparationService.setOutput();
    await this.buyFiatPreparationService.complete();
  }
}
