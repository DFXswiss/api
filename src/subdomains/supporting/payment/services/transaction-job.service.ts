import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { BankTx } from '../../bank-tx/bank-tx/bank-tx.entity';
import { BankTxService, TransactionBankTxTypeMapper } from '../../bank-tx/bank-tx/bank-tx.service';
import { CheckoutTx } from '../../fiat-payin/entities/checkout-tx.entity';
import { CheckoutTxService } from '../../fiat-payin/services/checkout-tx.service';
import { CryptoInput } from '../../payin/entities/crypto-input.entity';
import { PayInService } from '../../payin/services/payin.service';
import { TransactionSourceType, TransactionType } from '../entities/transaction.entity';
import { TransactionService } from './transaction.service';

@Injectable()
export class TransactionJobService {
  constructor(
    private readonly bankTxService: BankTxService,
    private readonly payInService: PayInService,
    private readonly checkoutTxService: CheckoutTxService,
    private readonly transactionService: TransactionService,
  ) {}

  // --- CHECK BUY FIAT --- //
  @Cron(CronExpression.EVERY_30_MINUTES)
  @Lock(7200)
  async addFiatOutputs(): Promise<void> {
    if (DisabledProcess(Process.SYNCHRONIZE_TRANSACTION)) return;

    const sortedUnassignedTx = Util.sort(
      [
        ...(await this.bankTxService.getBankTxWithoutTransaction()),
        ...(await this.payInService.getCryptoInputWithoutTransaction()),
        ...(await this.checkoutTxService.getCheckoutTxWithoutTransaction()),
      ],
      'created',
    );

    for (const unassignedTx of sortedUnassignedTx) {
      await this.transactionService.create({
        sourceId: unassignedTx.id,
        sourceType: this.getSourceType(unassignedTx),
        type: this.getType(unassignedTx),
      });
    }
  }

  private getType(tx: BankTx | CryptoInput | CheckoutTx): TransactionType {
    return tx instanceof BankTx
      ? TransactionBankTxTypeMapper[tx.type]
      : tx instanceof CheckoutTx
      ? TransactionType.BUY_CRYPTO
      : tx.route instanceof Sell
      ? TransactionType.BUY_FIAT
      : tx.route instanceof CryptoRoute
      ? TransactionType.BUY_CRYPTO
      : tx.route instanceof Staking
      ? TransactionType.STAKING
      : null;
  }

  private getSourceType(tx: BankTx | CryptoInput | CheckoutTx): TransactionSourceType {
    return tx instanceof BankTx
      ? TransactionSourceType.BANK_TX
      : tx instanceof CheckoutTx
      ? TransactionSourceType.CHECKOUT_TX
      : TransactionSourceType.CRYPTO_INPUT;
  }
}
