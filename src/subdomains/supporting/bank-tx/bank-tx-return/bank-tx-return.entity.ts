import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { CreditorData } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { ChargebackBlockReason } from 'src/subdomains/generic/support/dto/user-data-support.dto';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycStatus, RiskStatus, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
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
  inputAmount?: number;

  @Column({ length: 256, nullable: true })
  inputAsset?: string;

  @Column({ type: 'float', nullable: true })
  amountInChf?: number;

  @Column({ type: 'float', nullable: true })
  amountInEur?: number;

  @Column({ type: 'float', nullable: true })
  amountInUsd?: number;

  @Column({ type: 'timestamp', nullable: true })
  chargebackDate?: Date;

  @Column({ length: 256, nullable: true })
  chargebackRemittanceInfo?: string;

  @Column({ type: 'timestamp', nullable: true })
  chargebackAllowedDate?: Date;

  @Column({ type: 'timestamp', nullable: true })
  chargebackAllowedDateUser?: Date;

  @Column({ type: 'float', nullable: true })
  chargebackReferenceAmount?: number; // inputAsset

  @Column({ type: 'float', nullable: true })
  chargebackAmount?: number; // chargebackAsset

  @Column({ length: 256, nullable: true })
  chargebackAsset?: string;

  @Column({ length: 256, nullable: true })
  chargebackAllowedBy?: string;

  @Column({ length: 256, nullable: true })
  chargebackIban?: string;

  @Column({ type: 'text', nullable: true })
  chargebackCreditorData?: string;

  // Mail
  @Column({ length: 256, nullable: true })
  recipientMail?: string;

  @Column({ type: 'timestamp', nullable: true })
  mailSendDate?: Date;

  @Index()
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

  /**
   * Block reasons preventing automatic chargeback promotion.
   * Keep in sync with BankTxReturnService.chargebackTx() where / promotion conditions
   * and BankTxReturnService.getPendingChargebacks() pending set.
   * Empty array = auto-job can release this case.
   */
  getChargebackBlockReasons(): ChargebackBlockReason[] {
    // Fail-closed first: already approved/executed must never appear as waiting.
    // Redundant with BankTxReturnService.getPendingChargebacks() where — a lost exclusion there
    // would show a finished refund as pending and risk double payout by Compliance.
    // Matches refundClaimWhere() columns (no isComplete on this entity).
    if (this.chargebackAllowedDate || this.chargebackDate || this.chargebackOutput || this.chargebackBankTx) {
      return [];
    }

    const reasons: ChargebackBlockReason[] = [];

    if (this.chargebackAmount == null) {
      reasons.push(ChargebackBlockReason.MISSING_CHARGEBACK_AMOUNT);
    }

    if (!this.chargebackIban) {
      reasons.push(ChargebackBlockReason.MISSING_CHARGEBACK_TARGET);
    }

    if (!this.chargebackCreditorData) {
      reasons.push(ChargebackBlockReason.MISSING_CREDITOR_DATA);
    } else if (
      !Util.matchesCreditorName(this.userData.verifiedName, this.userData.completeName, this.creditorData?.name)
    ) {
      reasons.push(ChargebackBlockReason.NAME_MISMATCH);
    }

    const ud = this.userData;
    if (
      ![KycStatus.NA, KycStatus.COMPLETED].includes(ud.kycStatus) ||
      ud.status === UserDataStatus.BLOCKED ||
      ![RiskStatus.NA, RiskStatus.RELEASED].includes(ud.riskStatus)
    ) {
      reasons.push(ChargebackBlockReason.USER_NOT_RELEASED);
    }

    return reasons;
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
      case Blockchain.FRICK:
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
    chargebackReferenceAmount: number,
    chargebackAmount: number,
    chargebackAsset: string,
    chargebackAllowedDate: Date,
    chargebackAllowedDateUser: Date,
    chargebackAllowedBy: string,
    chargebackRemittanceInfo?: string,
    creditorData?: CreditorData,
  ): UpdateResult<BankTxReturn> {
    const hasCreditorData = creditorData && Object.values(creditorData).some((v) => v != null);

    const update: Partial<BankTxReturn> = {
      chargebackDate: chargebackAllowedDate ? new Date() : null,
      chargebackAllowedDate,
      chargebackAllowedDateUser,
      chargebackIban,
      chargebackReferenceAmount,
      chargebackAmount,
      chargebackAsset,
      // No chargebackOutput here on purpose. It is a relation column whose inverse side this code
      // saves — saving the FiatOutput sets the owning FK as a side effect — so passing it here only
      // duplicates that write, and needing it in hand beforehand is what forced the output-first
      // ordering the old code had. See BankTxReturnService.refundBankTx.
      chargebackAllowedBy,
      chargebackRemittanceInfo,
      chargebackCreditorData: hasCreditorData ? JSON.stringify(creditorData) : undefined,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
