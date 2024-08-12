import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CryptoInput, PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionHelper, ValidationError } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { SellRepository } from '../../route/sell.repository';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatService } from './buy-fiat.service';

interface RouteIdentifier {
  id: number;
  address: string;
  blockchains: string;
}

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

  private async filterSellPayIns(allPayIns: CryptoInput[]): Promise<[CryptoInput, RouteIdentifier][]> {
    const routes = await this.sellRepository
      .createQueryBuilder('sell')
      .innerJoin('sell.deposit', 'deposit')
      .select('sell.id', 'id')
      .addSelect('deposit.address', 'address')
      .addSelect('deposit.blockchains', 'blockchains')
      .getRawMany<RouteIdentifier>();

    return this.pairRoutesWithPayIns(routes, allPayIns);
  }

  private pairRoutesWithPayIns(routes: RouteIdentifier[], allPayIns: CryptoInput[]): [CryptoInput, RouteIdentifier][] {
    const result = [];

    for (const payIn of allPayIns) {
      const relevantRoute = routes.find(
        (r) =>
          payIn.address.address.toLowerCase() === r.address.toLowerCase() &&
          r.blockchains.includes(payIn.address.blockchain),
      );

      relevantRoute && result.push([payIn, relevantRoute]);
    }

    return result;
  }

  private async createBuyFiatsAndAckPayIns(payInsPairs: [CryptoInput, RouteIdentifier][]): Promise<void> {
    for (const [payIn, sellIdentifier] of payInsPairs) {
      try {
        const sellRoute = await this.sellRepository.findOne({
          relations: { deposit: true, user: { userData: { bankDatas: true } } },
          where: { id: sellIdentifier.id },
        });

        const alreadyExists = await this.buyFiatRepo.existsBy({ cryptoInput: { id: payIn.id } });

        if (!alreadyExists) {
          const result = await this.transactionHelper.validateInput(payIn.asset, payIn.amount);

          if (result === ValidationError.PAY_IN_TOO_SMALL) {
            await this.payInService.ignorePayIn(payIn, PayInPurpose.BUY_FIAT, sellRoute);
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
