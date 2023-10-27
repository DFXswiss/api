import { Injectable } from '@nestjs/common';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { Between, In, IsNull, Not } from 'typeorm';
import { CheckStatus } from '../enums/check-status.enum';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';

@Injectable()
export class BuyCryptoPreparationService {
  private readonly logger = new DfxLogger(BuyCryptoPreparationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly priceProviderService: PriceProviderService,
    private readonly fiatService: FiatService,
    private readonly bankDataService: BankDataService,
  ) {}

  async doAmlCheck(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: { amlCheck: IsNull(), amlReason: IsNull(), bankTx: Not(IsNull()), buy: Not(IsNull()), status: IsNull() },
      relations: ['bankTx', 'buy', 'buy.user', 'buy.user.wallet', 'buy.user.userData', 'buy.user.userData.users'],
    });
    if (entities.length === 0) return;

    this.logger.verbose(
      `AmlCheck for ${entities.length} buy-crypto transaction(s). Transaction ID(s): ${entities.map((t) => t.id)}`,
    );

    // CHF/EUR Price
    const fiatEur = await this.fiatService.getFiatByName('EUR');
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      const inputCurrency = await this.fiatService.getFiatByName(entity.bankTx.txCurrency);

      const { minVolume, minFee, feeAmount, fee } = await this.transactionHelper.getTxDetails(
        entity.bankTx.txAmount,
        undefined,
        inputCurrency,
        entity.target.asset,
      );

      const inputAssetEurPrice = await this.priceProviderService.getPrice(inputCurrency, fiatEur);
      const inputAssetChfPrice = await this.priceProviderService.getPrice(inputCurrency, fiatChf);

      const bankData = await this.bankDataService.getActiveBankDataWithIban(entity.bankTx.iban);

      const dateFrom = Util.daysBefore(30);

      const userDataVolume = await this.getUserVolume(
        entity.user.userData.users.map((user) => user.id),
        dateFrom,
      );

      await this.buyCryptoRepo.update(
        ...entity.amlCheckAndFillUp(
          inputAssetEurPrice,
          inputAssetChfPrice,
          feeAmount,
          fee,
          minFee,
          minVolume,
          userDataVolume.buy,
          bankData?.userData,
        ),
      );
    }
  }

  async refreshFeeAndPrice(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        status: IsNull(),
        isComplete: false,
        payoutConfirmationDate: IsNull(),
      },
      relations: [
        'bankTx',
        'buy',
        'buy.user',
        'buy.user.userData',
        'cryptoInput',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.userData',
      ],
    });

    for (const entity of entities) {
      const inputCurrency = entity.bankTx
        ? await this.fiatService.getFiatByName(entity.bankTx.txCurrency)
        : entity.cryptoInput.asset;

      const { feeAmount, fee } = await this.transactionHelper.getTxDetails(
        entity.bankTx.txAmount,
        undefined,
        inputCurrency,
        entity.target.asset,
        entity.user.userData,
      );

      if (entity.inputAsset != entity.inputReferenceAsset) {
        const inputReferenceCurrency = await this.fiatService.getFiatByName(entity.inputReferenceAsset);
        const price = await this.priceProviderService.getPrice(inputCurrency, inputReferenceCurrency);

        await this.buyCryptoRepo.update(...entity.setFeeAndPrice(fee, price.convert(feeAmount, 2)));

        continue;
      }

      await this.buyCryptoRepo.update(...entity.setFeeAndPrice(fee, feeAmount));
    }
  }

  // --- HELPER METHODS --- //

  private async getUserVolume(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ buy: number; convert: number }> {
    const buyVolume = await this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('COUNT(amountInEur)', 'volume')
      .leftJoin('buyCrypto.bankTx', 'bankTx')
      .leftJoin('buyCrypto.buy', 'buy')
      .leftJoin('buy.user', 'user')
      .where(`user.id = :userId`, { userId: In(userIds) })
      .andWhere('bankTx.created = :date', { date: Between(dateFrom, dateTo) })
      .andWhere('buyCrypto.amlCheck = :amlCheck', { amlCheck: CheckStatus.PASS })
      .getRawOne<{ volume: number }>()
      .then((result) => result.volume);

    const convertVolume = await this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('COUNT(amountInEur)', 'volume')
      .leftJoin('buyCrypto.cryptoInput', 'cryptoInput')
      .leftJoin('buyCrypto.cryptoRoute', 'cryptoRoute')
      .leftJoin('cryptoRoute.user', 'user')
      .where(`user.id = :userId`, { userId: In(userIds) })
      .andWhere('cryptoInput.created = :date', { date: Between(dateFrom, dateTo) })
      .andWhere('buyCrypto.amlCheck = :amlCheck', { amlCheck: CheckStatus.PASS })
      .getRawOne<{ volume: number }>()
      .then((result) => result.volume);

    return { buy: buyVolume, convert: convertVolume };
  }
}
