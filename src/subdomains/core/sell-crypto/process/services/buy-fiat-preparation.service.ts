import { Injectable } from '@nestjs/common';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { IsNull, Not } from 'typeorm';
import { CheckStatus } from '../../../buy-crypto/process/enums/check-status.enum';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatService } from './buy-fiat.service';

@Injectable()
export class BuyFiatPreparationService {
  private readonly logger = new DfxLogger(BuyFiatPreparationService);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly priceProviderService: PriceProviderService,
    private readonly fiatService: FiatService,
    private readonly assetService: AssetService,
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
        const inputReferenceCurrency =
          (await this.fiatService.getFiatByName(entity.inputReferenceAsset)) ??
          (await this.assetService.getNativeMainLayerAsset(entity.inputReferenceAsset));

        const inputReferencePrice = Price.create(
          entity.cryptoInput.asset.name,
          inputReferenceCurrency.name,
          entity.inputAmount / entity.inputReferenceAmount,
        );

        const { fee } = await this.transactionHelper.getTxFeeInfos(
          entity.inputAmount,
          entity.cryptoInput.asset,
          entity.sell.fiat,
          CryptoPaymentMethod.CRYPTO,
          FiatPaymentMethod.BANK,
          inputReferencePrice,
          entity.sell.user,
        );

        const referenceEurPrice = await this.priceProviderService.getPrice(inputReferenceCurrency, fiatEur);
        const referenceChfPrice = await this.priceProviderService.getPrice(inputReferenceCurrency, fiatChf);

        const amountInEur = referenceEurPrice.convert(entity.inputReferenceAmount, 2);

        for (const feeId of fee.fees) {
          await this.feeService.increaseTxUsages(amountInEur, feeId, entity.sell.user.userData);
        }

        await this.buyFiatRepo.update(
          ...entity.setFeeAndFiatReference(
            amountInEur,
            referenceChfPrice.convert(entity.inputReferenceAmount, 2),
            fee.fees,
            fee.rate,
            fee.fixed,
            fee.payoutRefBonus,
            fee.min,
            inputReferenceCurrency instanceof Fiat ? fee.min : referenceEurPrice.convert(fee.min, 2),
            fee.total,
            referenceChfPrice.convert(fee.total, 2),
          ),
        );

        await this.buyFiatService.updateSellVolume([entity.sell?.id]);
        await this.buyFiatService.updateRefVolume([entity.usedRef]);
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }
}
