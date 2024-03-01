import { Injectable } from '@nestjs/common';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { In, IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../buy-crypto/process/enums/check-status.enum';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatService } from './buy-fiat.service';

@Injectable()
export class BuyFiatPreparationService {
  private readonly logger = new DfxLogger(BuyFiatPreparationService);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly pricingService: PricingService,
    private readonly fiatService: FiatService,
    private readonly feeService: FeeService,
    private readonly buyFiatService: BuyFiatService,
  ) {}

  async refreshFee(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        isComplete: false,
        percentFee: IsNull(),
        inputReferenceAmount: Not(IsNull()),
      },
      relations: ['sell', 'sell.user', 'sell.user.wallet', 'sell.user.userData', 'cryptoInput'],
    });

    // CHF/EUR Price
    const fiatEur = await this.fiatService.getFiatByName('EUR');
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      try {
        const inputCurrency = entity.cryptoInput.asset;

        const { fee } = await this.transactionHelper.getTxFeeInfos(
          entity.inputAmount,
          inputCurrency,
          inputCurrency,
          entity.sell.fiat,
          CryptoPaymentMethod.CRYPTO,
          FiatPaymentMethod.BANK,
          entity.sell.user,
        );

        const eurPrice = await this.pricingService.getPrice(inputCurrency, fiatEur, false);
        const chfPrice = await this.pricingService.getPrice(inputCurrency, fiatChf, false);

        const amountInChf = chfPrice.convert(entity.inputAmount, 2);

        await this.buyFiatRepo.update(
          ...entity.setFeeAndFiatReference(
            eurPrice.convert(entity.inputAmount, 2),
            amountInChf,
            fee.fees,
            fee.rate,
            fee.fixed,
            fee.payoutRefBonus,
            fee.min,
            eurPrice.convert(fee.min, 2),
            fee.total,
            chfPrice.convert(fee.total, 2),
          ),
        );

        for (const feeId of fee.fees) {
          await this.feeService.increaseTxUsages(amountInChf, feeId, entity.sell.user.userData);
        }

        await this.buyFiatService.updateSellVolume([entity.sell?.id]);
        await this.buyFiatService.updateRefVolume([entity.usedRef]);
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }

  async setOutput(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        isComplete: false,
        inputReferenceAmountMinusFee: Not(IsNull()),
        outputAmount: IsNull(),
      },
      relations: ['sell', 'cryptoInput'],
    });

    for (const entity of entities) {
      try {
        const asset = entity.cryptoInput.asset;
        const currency = entity.sell.fiat;
        const price = await this.pricingService.getPrice(asset, currency, false);

        await this.buyFiatRepo.update(
          ...entity.setOutput(price.convert(entity.inputReferenceAmountMinusFee), currency),
        );
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} output setting:`, e);
      }
    }
  }

  async setOutputAssetEntity(): Promise<void> {
    const entities = await this.buyFiatRepo.find({
      where: {
        outputAsset: Not(IsNull()),
        outputAssetEntity: IsNull(),
      },
      relations: ['sell'],
    });

    for (const entity of entities) {
      try {
        const outputAssetEntity = entity.sell.fiat;
        const outputReferenceAssetEntity = entity.outputReferenceAsset
          ? await this.fiatService.getFiatByName(entity.outputReferenceAsset)
          : null;

        await this.buyFiatRepo.update(entity.id, { outputAssetEntity, outputReferenceAssetEntity });
      } catch (e) {
        this.logger.error(`Error during buy-fiat ${entity.id} outputAssetEntity setting:`, e);
      }
    }
  }

  // --- HELPER METHODS --- //

  async getUserVolume(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ sell: number }> {
    const sellVolume = await this.buyFiatRepo
      .createQueryBuilder('buyFiat')
      .select('SUM(amountInChf)', 'volume')
      .leftJoin('buyFiat.cryptoInput', 'cryptoInput')
      .leftJoin('buyFiat.sell', 'sell')
      .where(`sell.userId = :userId`, { userId: In(userIds) })
      .andWhere('cryptoInput.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .andWhere('buyFiat.amlCheck = :amlCheck', { amlCheck: CheckStatus.PASS })
      .getRawOne<{ volume: number }>()
      .then((result) => result.volume);

    return { sell: sellVolume };
  }
}
