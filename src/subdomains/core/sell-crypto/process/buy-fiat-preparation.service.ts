import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { Between, In, IsNull } from 'typeorm';
import { CheckStatus } from '../../buy-crypto/process/enums/check-status.enum';
import { BuyFiatRepository } from './buy-fiat.repository';

@Injectable()
export class BuyFiatPreparationService {
  constructor(
    private readonly buyCryptoRepo: BuyFiatRepository,
    private readonly transactionHelper: TransactionHelper,
    private readonly priceProviderService: PriceProviderService,
    private readonly assetService: AssetService,
  ) {}

  async refreshFeeAndPrice(): Promise<void> {
    const entities = await this.buyCryptoRepo.find({
      where: {
        amlCheck: CheckStatus.PASS,
        outputAmount: IsNull(),
        isComplete: false,
        payoutConfirmationDate: IsNull(),
      },
      relations: ['cryptoInput', 'sell', 'sell.user', 'sell.user.userData'],
    });

    for (const entity of entities) {
      const { feeAmount, fee } = await this.transactionHelper.getTxDetails(
        entity.cryptoInput.amount,
        undefined,
        entity.cryptoInput.asset,
        entity.sell.fiat,
        entity.sell.user.userData,
      );

      if (entity.inputAsset != entity.inputReferenceAsset) {
        const referenceAsset = await this.assetService.getAssetByQuery(
          entity.inputReferenceAsset == 'BTC'
            ? { dexName: 'BTC', blockchain: Blockchain.BITCOIN, type: AssetType.COIN }
            : { dexName: 'USDT', blockchain: Blockchain.ETHEREUM, type: AssetType.TOKEN },
        );
        const price = await this.priceProviderService.getPrice(entity.cryptoInput.asset, referenceAsset);

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
