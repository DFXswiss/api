import { Injectable } from '@nestjs/common';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper, ValidationError } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { IsNull, Not } from 'typeorm';
import { Sell } from '../../route/sell.entity';
import { SellRepository } from '../../route/sell.repository';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatService } from './buy-fiat.service';

@Injectable()
export class BuyFiatRegistrationService {
  private readonly logger = new DfxLogger(BuyFiatRegistrationService);

  constructor(
    private readonly buyFiatRepo: BuyFiatRepository,
    private readonly buyFiatService: BuyFiatService,
    private readonly sellRepository: SellRepository,
    private readonly payInService: PayInService,
    private readonly transactionHelper: TransactionHelper,
  ) {}

  async registerSellPayIn(): Promise<void> {
    const newPayIns = await this.payInService.getNewPayIns();

    if (newPayIns.length === 0) return;

    const sellPayIns = await this.filterSellPayIns(newPayIns);

    sellPayIns.length > 0 &&
      this.logger.verbose(
        `Registering ${sellPayIns.length} new buy-fiat(s) from crypto pay-in(s) ID(s): ${sellPayIns.map(
          (s) => s[0].id,
        )}`,
      );

    await this.createBuyFiatsAndAckPayIns(sellPayIns);
  }

  //*** HELPER METHODS ***//

  private async filterSellPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, Sell][]> {
    const routes = await this.sellRepository.find({
      where: { deposit: Not(IsNull()) },
      relations: ['deposit', 'user', 'user.userData', 'user.userData.bankDatas'],
    });

    return this.pairRoutesWithPayIns(routes, allPayIns);
  }

  private pairRoutesWithPayIns(routes: Sell[], allPayIns: CryptoInput[]): [CryptoInput, Sell][] {
    const result = [];

    for (const payIn of allPayIns) {
      const relevantRoute = routes.find(
        (r) =>
          payIn.address.address.toLowerCase() === r.deposit.address.toLowerCase() &&
          r.deposit.blockchainList.includes(payIn.address.blockchain),
      );

      relevantRoute && result.push([payIn, relevantRoute]);
    }

    return result;
  }

  private async createBuyFiatsAndAckPayIns(payInsPairs: [CryptoInput, Sell][]): Promise<void> {
    for (const [payIn, sellRoute] of payInsPairs) {
      try {
        const alreadyExists = await this.buyFiatRepo.exist({ where: { cryptoInput: { id: payIn.id } } });

        if (!alreadyExists) {
          const result = await this.transactionHelper.validateInput(payIn.asset, payIn.amount);

          if (result === ValidationError.PAY_IN_TOO_SMALL) {
            await this.payInService.ignorePayIn(payIn, PayInPurpose.BUY_FIAT, sellRoute);
            continue;
          } else if (result === ValidationError.PAY_IN_NOT_SELLABLE) {
            await this.payInService.returnPayIn(
              payIn,
              PayInPurpose.BUY_FIAT,
              BlockchainAddress.create(sellRoute.user.address, payIn.asset.blockchain),
              sellRoute,
            );
            continue;
          }

          await this.buyFiatService.createFromCryptoInput(payIn, sellRoute);
        }

        await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_FIAT, sellRoute);
      } catch (e) {
        this.logger.error(`Error during buy-fiat pay-in registration (pay-in ${payIn.id}):`, e);
      }
    }
  }
}
