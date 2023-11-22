import { Injectable } from '@nestjs/common';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { Between, In, IsNull, Not } from 'typeorm';
import { BuyPaymentMethod } from '../../routes/buy/dto/get-buy-payment-info.dto';
import { BuyCryptoFee } from '../entities/buy-crypto-fees.entity';
import { BuyCrypto } from '../entities/buy-crypto.entity';
import { CheckStatus } from '../enums/check-status.enum';
import { BuyCryptoRepository } from '../repositories/buy-crypto.repository';
import { BuyCryptoWebhookService } from './buy-crypto-webhook.service';

@Injectable()
export class BuyCryptoPreparationService {
  private readonly logger = new DfxLogger(BuyCryptoPreparationService);

  constructor(
    private readonly buyCryptoRepo: BuyCryptoRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly priceProviderService: PriceProviderService,
    private readonly fiatService: FiatService,
    private readonly bankDataService: BankDataService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly assetService: AssetService,
    private readonly feeService: FeeService,
  ) {}

  async doAmlCheck(): Promise<void> {
    // Atm only for bankTx BuyCrypto

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
      try {
        const inputReferenceCurrency = await this.fiatService.getFiatByName(entity.bankTx.txCurrency);
        const inputCurrency = await this.fiatService.getFiatByName(entity.inputAsset);

        const inputReferencePrice = await this.priceProviderService.getPrice(inputCurrency, inputReferenceCurrency);

        const { feeAmount, fee, minFee, minVolume } = await this.transactionHelper.getTxFeeInfos(
          entity.inputAmount,
          inputCurrency,
          entity.target.asset,
          inputReferencePrice,
          entity.user.userData,
          BuyPaymentMethod.BANK,
        );

        const inputAssetEurPrice = await this.priceProviderService.getPrice(inputReferenceCurrency, fiatEur);
        const inputAssetChfPrice = await this.priceProviderService.getPrice(inputReferenceCurrency, fiatChf);

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
            userDataVolume.buy + userDataVolume.checkout, // + convert?
            bankData?.userData,
          ),
        );
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} AML check:`, e);
      }
    }
  }

  async refreshFee(): Promise<void> {
    // Atm only for bankTx/checkoutTx BuyCrypto

    const entities = await this.buyCryptoRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        status: IsNull(),
        isComplete: false,
        percentFee: IsNull(),
        cryptoInput: IsNull(),
        inputReferenceAmount: Not(IsNull()),
      },
      relations: [
        'bankTx',
        'checkoutTx',
        'buy',
        'buy.user',
        'buy.user.userData',
        'cryptoInput',
        'cryptoRoute',
        'cryptoRoute.user',
        'cryptoRoute.user.userData',
      ],
    });

    // CHF/EUR Price
    const fiatEur = await this.fiatService.getFiatByName('EUR');
    const fiatChf = await this.fiatService.getFiatByName('CHF');

    for (const entity of entities) {
      // Only for bankTx/checkoutTx BuyCrypto
      try {
        const inputReferenceCurrency = await this.fiatService.getFiatByName(entity.inputReference.currency);
        const inputCurrency = await this.fiatService.getFiatByName(entity.inputAsset);

        const inputReferencePrice = await this.priceProviderService.getPrice(inputCurrency, inputReferenceCurrency);

        const { feeAmount, fee, minFee } = await this.transactionHelper.getTxFeeInfos(
          entity.inputAmount,
          inputCurrency,
          entity.target.asset,
          inputReferencePrice,
          entity.user.userData,
          BuyPaymentMethod.BANK,
        );

        const referenceEurPrice = await this.priceProviderService.getPrice(inputReferenceCurrency, fiatEur);
        const referenceChfPrice = await this.priceProviderService.getPrice(inputReferenceCurrency, fiatChf);

        for (const feeId of fee.fees) {
          await this.feeService.increaseTxUsage(feeId);
        }

        await this.buyCryptoRepo.update(
          ...entity.setFeeAndFiatReference(
            referenceEurPrice.convert(entity.inputReference.amount, 2),
            referenceChfPrice.convert(entity.inputReference.amount, 2),
            fee,
            minFee,
            minFee,
            feeAmount,
            referenceChfPrice.convert(feeAmount, 2),
          ),
        );
      } catch (e) {
        this.logger.error(`Error during buy-crypto ${entity.id} fee and fiat reference refresh:`, e);
      }
    }
  }

  async prepareTransactions(): Promise<void> {
    try {
      const txInput = await this.buyCryptoRepo.find({
        where: {
          inputReferenceAmountMinusFee: Not(IsNull()),
          percentFee: Not(IsNull()),
          outputReferenceAsset: IsNull(),
          outputAsset: IsNull(),
          batch: IsNull(),
        },
        relations: [
          'bankTx',
          'buy',
          'buy.user',
          'buy.user.wallet',
          'buy.asset',
          'batch',
          'cryptoRoute',
          'cryptoRoute.user',
          'cryptoRoute.user.wallet',
          'cryptoRoute.asset',
          'cryptoInput',
        ],
      });

      if (txInput.length === 0) return;

      this.logger.verbose(
        `Buy-crypto transaction input. Processing ${txInput.length} transaction(s). Transaction ID(s): ${txInput.map(
          (t) => t.id,
        )}`,
      );

      const txWithAssets = await this.defineAssetPair(txInput);
      const txWithFeeConstraints = this.setFeeConstraints(txWithAssets);

      for (const tx of txWithFeeConstraints) {
        await this.buyCryptoRepo.save(tx);
        await this.buyCryptoWebhookService.triggerWebhook(tx);
      }
    } catch (e) {
      this.logger.error('Error during buy-crypto preparation:', e);
    }
  }

  // --- HELPER METHODS --- //

  private async defineAssetPair(transactions: BuyCrypto[]): Promise<BuyCrypto[]> {
    for (const tx of transactions) {
      try {
        const outputReferenceAssetToFetch = tx.defineAssetExchangePair();

        if (outputReferenceAssetToFetch) {
          const { outputReferenceAssetName, type } = outputReferenceAssetToFetch;

          const outputReferenceAsset = await this.assetService.getAssetByQuery({
            dexName: outputReferenceAssetName,
            blockchain: tx.outputAsset.blockchain,
            type,
          });

          if (!outputReferenceAsset) {
            throw new Error(
              `Asset with name ${outputReferenceAssetName}, type: ${type}, blockchain: ${tx.outputAsset.blockchain} not found by asset service.`,
            );
          }

          tx.setOutputReferenceAsset(outputReferenceAsset);
        }
      } catch (e) {
        this.logger.error('Error while defining buy-crypto asset pair:', e);
      }
    }

    return transactions.filter((tx) => tx.outputReferenceAsset && tx.outputAsset);
  }

  private setFeeConstraints(transactions: BuyCrypto[]): BuyCrypto[] {
    for (const tx of transactions) {
      const fee = BuyCryptoFee.create(tx);
      tx.setFeeConstraints(fee);
    }

    return transactions;
  }

  private async getUserVolume(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ buy: number; convert: number; checkout: number }> {
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

    const checkoutVolume = await this.buyCryptoRepo
      .createQueryBuilder('buyCrypto')
      .select('COUNT(amountInEur)', 'volume')
      .leftJoin('buyCrypto.checkoutTx', 'checkoutTx')
      .leftJoin('buyCrypto.buy', 'buy')
      .leftJoin('buy.user', 'user')
      .where(`user.id = :userId`, { userId: In(userIds) })
      .andWhere('checkoutTx.requestedOn = :date', { date: Between(dateFrom, dateTo) })
      .andWhere('buyCrypto.amlCheck = :amlCheck', { amlCheck: CheckStatus.PASS })
      .getRawOne<{ volume: number }>()
      .then((result) => result.volume);

    return { buy: buyVolume, convert: convertVolume, checkout: checkoutVolume };
  }
}
