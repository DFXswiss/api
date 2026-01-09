import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { CreditorData } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BankService } from '../../bank/bank/bank.service';
import { FiatOutput } from '../../fiat-output/fiat-output.entity';
import { PaymentMethod } from '../../payment/dto/payment-method.enum';
import { Transaction } from '../../payment/entities/transaction.entity';
import { Price } from '../../pricing/domain/entities/price';
import { BankTx } from '../bank-tx/entities/bank-tx.entity';

@Entity()
export class BankTxReturn extends IEntity {
  @OneToOne(() => BankTx, (bankTx) => bankTx.bankTxReturn, { nullable: false })
  @JoinColumn()
  bankTx: BankTx;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  chargebackBankTx?: BankTx;

  @OneToOne(() => Transaction, { eager: true, nullable: true })
  @JoinColumn()
  transaction?: Transaction;

  @OneToOne(() => FiatOutput, { nullable: true })
  @JoinColumn()
  chargebackOutput?: FiatOutput;

  @Column({ length: 256, nullable: true })
  info?: string;

  @Column({ type: 'float', nullable: true })
  amountInChf?: number;

  @Column({ type: 'float', nullable: true })
  amountInEur?: number;

  @Column({ type: 'float', nullable: true })
  amountInUsd?: number;

  @Column({ type: 'datetime2', nullable: true })
  chargebackDate?: Date;

  @Column({ length: 256, nullable: true })
  chargebackRemittanceInfo?: string;

  @Column({ type: 'datetime2', nullable: true })
  chargebackAllowedDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  chargebackAllowedDateUser?: Date;

  @Column({ type: 'float', nullable: true })
  chargebackAmount?: number;

  @Column({ length: 256, nullable: true })
  chargebackAllowedBy?: string;

  @Column({ length: 256, nullable: true })
  chargebackIban?: string;

  @Column({ length: 'MAX', nullable: true })
  chargebackCreditorData?: string;

  // Mail
  @Column({ length: 256, nullable: true })
  recipientMail?: string;

  @Column({ type: 'datetime2', nullable: true })
  mailSendDate?: Date;

  @ManyToOne(() => UserData, (userData) => userData.bankTxReturns, { nullable: true, eager: true })
  userData?: UserData;

  //*** METHODS ***//

  get wallet(): Wallet {
    return this.userData.wallet;
  }

  get chargebackBankRemittanceInfo(): string {
    return `Chargeback ${this.bankTx.id} Zahlung kann keinem Kundenauftrag zugeordnet werden. Weitere Infos unter dfx.swiss/help`;
  }

  get creditorData(): CreditorData | undefined {
    if (!this.chargebackCreditorData) return undefined;
    try {
      return JSON.parse(this.chargebackCreditorData);
    } catch {
      return undefined;
    }
  }

  get paymentMethodIn(): PaymentMethod {
    return this.bankTx.paymentMethodIn;
  }

  get chargebackBankFee(): number {
    return this.bankTx.chargebackBankFee;
  }

  get refundAmount(): number {
    return this.bankTx.refundAmount;
  }

  get manualChfPrice(): Price {
    return undefined;
  }

  confirmSentMail(): UpdateResult<BankTxReturn> {
    const update: Partial<BankTxReturn> = {
      recipientMail: this.userData.mail,
      mailSendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  setFiatAmount(amountInEur: number, amountInChf: number, amountInUsd: number): UpdateResult<BankTxReturn> {
    const update: Partial<BankTxReturn> = {
      amountInEur,
      amountInChf,
      amountInUsd,
      info: 'NA',
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  pendingInputAmount(asset: Asset): number {
    switch (asset.blockchain) {
      case Blockchain.MAERKI_BAUMANN:
      case Blockchain.OLKYPAY:
      case Blockchain.YAPEAL:
        return BankService.isBankMatching(asset, this.bankTx.accountIban) ? this.bankTx.amount : 0;

      default:
        return 0;
    }
  }

  pendingOutputAmount(_: Asset): number {
    return 0;
  }

  chargebackFillUp(
    chargebackIban: string,
    chargebackAmount: number,
    chargebackAllowedDate: Date,
    chargebackAllowedDateUser: Date,
    chargebackAllowedBy: string,
    chargebackOutput?: FiatOutput,
    chargebackRemittanceInfo?: string,
    creditorData?: CreditorData,
  ): UpdateResult<BankTxReturn> {
    const hasCreditorData = creditorData && Object.values(creditorData).some((v) => v != null);

    const update: Partial<BankTxReturn> = {
      chargebackDate: chargebackAllowedDate ? new Date() : null,
      chargebackAllowedDate,
      chargebackAllowedDateUser,
      chargebackIban,
      chargebackAmount,
      chargebackOutput,
      chargebackAllowedBy,
      chargebackRemittanceInfo,
      chargebackCreditorData: hasCreditorData ? JSON.stringify(creditorData) : undefined,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
