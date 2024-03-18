import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { RefRewardService } from 'src/subdomains/core/referral/reward/ref-reward.service';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { BankTx, BankTxType } from '../../bank-tx/bank-tx/bank-tx.entity';
import { BankTxService, TransactionBankTxTypeMapper } from '../../bank-tx/bank-tx/bank-tx.service';
import { CheckoutTx } from '../../fiat-payin/entities/checkout-tx.entity';
import { CheckoutTxService } from '../../fiat-payin/services/checkout-tx.service';
import { CryptoInput } from '../../payin/entities/crypto-input.entity';
import { PayInService } from '../../payin/services/payin.service';
import { CreateTransactionDto } from '../dto/input/create-transaction.dto';
import { TransactionSourceType, TransactionTypeInternal } from '../entities/transaction.entity';
import { TransactionService } from './transaction.service';

@Injectable()
export class TransactionJobService {
  private readonly logger = new DfxLogger(TransactionJobService);

  constructor(
    private readonly bankTxService: BankTxService,
    private readonly payInService: PayInService,
    private readonly checkoutTxService: CheckoutTxService,
    private readonly transactionService: TransactionService,
    private readonly refRewardService: RefRewardService,
    private readonly settingService: SettingService,
  ) {}

  // --- SYNCHRONIZE TRANSACTIONS --- //
  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async synchronizeTransactions(): Promise<void> {
    if (DisabledProcess(Process.SYNCHRONIZE_TRANSACTION)) return;

    try {
      const date = await this.settingService.get('transactionFilterDate', '2022-07-31');

      const sortedUnassignedTx = Util.sort(
        [
          ...(await this.bankTxService.getBankTxWithoutTransaction(new Date(date))),
          ...(await this.payInService.getCryptoInputWithoutTransaction(new Date(date))),
          ...(await this.checkoutTxService.getCheckoutTxWithoutTransaction(new Date(date))),
          ...(await this.refRewardService.getRewardsWithoutTransaction(new Date(date))),
        ],
        'created',
      );

      for (const unassignedTx of sortedUnassignedTx) {
        await this.transactionService.create({
          sourceType: this.getSourceType(unassignedTx),
          created: unassignedTx.created,
          ...this.getTypeAndEntity(unassignedTx),
        });
      }
    } catch (e) {
      this.logger.error(`Error during synchronize transactions:`, e);
    }
  }

  private getTypeAndEntity(tx: BankTx | CryptoInput | CheckoutTx | RefReward): Partial<CreateTransactionDto> {
    if (tx instanceof BankTx) {
      const type = TransactionBankTxTypeMapper[tx.type];
      return tx.type === BankTxType.BANK_TX_RETURN
        ? { type, bankTxReturn: tx.bankTxReturn, bankTx: tx }
        : tx.type === BankTxType.BANK_TX_REPEAT
        ? { type, bankTxRepeat: tx.bankTxRepeat, bankTx: tx }
        : tx.type === BankTxType.BUY_CRYPTO
        ? { type, buyCrypto: tx.buyCrypto, bankTx: tx }
        : { type, bankTx: tx };
    }
    return tx instanceof RefReward
      ? { type: TransactionTypeInternal.REF_REWARD, refReward: tx }
      : tx instanceof CheckoutTx
      ? { type: TransactionTypeInternal.BUY_CRYPTO, buyCrypto: tx.buyCrypto, checkoutTx: tx }
      : tx.route instanceof Sell
      ? { type: TransactionTypeInternal.BUY_FIAT, buyFiat: tx.buyFiat, cryptoInput: tx }
      : tx.route instanceof CryptoRoute
      ? { type: TransactionTypeInternal.CRYPTO_CRYPTO, buyCrypto: tx.buyCrypto, cryptoInput: tx }
      : {};
  }

  private getSourceType(tx: BankTx | CryptoInput | CheckoutTx | RefReward): TransactionSourceType {
    return tx instanceof BankTx
      ? TransactionSourceType.BANK_TX
      : tx instanceof CheckoutTx
      ? TransactionSourceType.CHECKOUT_TX
      : tx instanceof CryptoInput
      ? TransactionSourceType.CRYPTO_INPUT
      : TransactionSourceType.REF;
  }
}
