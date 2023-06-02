import { Injectable } from '@nestjs/common';
import { SendStrategy, SendType } from './base/send.strategy';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';

@Injectable()
export class LightningStrategy extends SendStrategy {
  protected readonly logger = new DfxLogger(LightningStrategy);

  constructor(
    private readonly payInRepo: PayInRepository,
    priceProvider: PriceProviderService,
    payoutService: PayoutService,
    transactionHelper: TransactionHelper,
  ) {
    super(priceProvider, payoutService, transactionHelper);
  }

  async doSend(payIns: CryptoInput[], _: SendType): Promise<void> {
    for (const payIn of payIns) {
      payIn.completed();

      await this.payInRepo.save(payIn);
    }
  }

  async checkConfirmations(payIns: CryptoInput[]): Promise<void> {
    for (const payIn of payIns) {
      payIn.confirm();

      await this.payInRepo.save(payIn);
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    throw new Error('Method not implemented.');
  }
}
