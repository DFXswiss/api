import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BankService } from '../../bank/bank/bank.service';
import { FiatOutput } from '../../fiat-output/fiat-output.entity';
import { Transaction } from '../../payment/entities/transaction.entity';
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
  chargebackOutput: FiatOutput;

  @Column({ length: 256, nullable: true })
  info?: string;

  @Column({ type: 'float', nullable: true })
  amountInChf?: number;

  @Column({ type: 'float', nullable: true })
  amountInEur?: number;

  @Column({ type: 'float', nullable: true })
  amountInUsd?: number;

  @Column({ type: 'datetime2', nullable: true })
  chargebackDate: Date;

  @Column({ length: 256, nullable: true })
  chargebackRemittanceInfo: string;

  @Column({ type: 'datetime2', nullable: true })
  chargebackAllowedDate: Date;

  @Column({ type: 'datetime2', nullable: true })
  chargebackAllowedDateUser: Date;

  @Column({ type: 'float', nullable: true })
  chargebackAmount: number;

  @Column({ length: 256, nullable: true })
  chargebackAllowedBy: string;

  @Column({ length: 256, nullable: true })
  chargebackIban: string;

  @ManyToOne(() => UserData, (userData) => userData.bankTxReturns, { nullable: true, eager: true })
  userData: UserData;

  //*** METHODS ***//

  setRemittanceInfo(): UpdateResult<BankTxReturn> {
    const update: Partial<BankTxReturn> = {
      chargebackRemittanceInfo: `Chargeback ${this.bankTx?.id} Zahlung kann keinem Kundenauftrag zugeordnet werden. Weitere Infos unter dfx.swiss/help`,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  setFiatAmount(
    amountInEur: number,
    amountInChf: number,
    amountInUsd: number,
    chargebackBankTx: BankTx,
  ): UpdateResult<BankTxReturn> {
    const update: Partial<BankTxReturn> = {
      amountInEur,
      amountInChf,
      amountInUsd,
      chargebackBankTx,
      info: 'NA',
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  pendingInputAmount(asset: Asset): number {
    switch (asset.blockchain as string) {
      case 'MaerkiBaumann':
      case 'Olkypay':
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
  ): UpdateResult<BankTxReturn> {
    const update: Partial<BankTxReturn> = {
      chargebackDate: chargebackAllowedDate ? new Date() : null,
      chargebackAllowedDate,
      chargebackAllowedDateUser,
      chargebackIban,
      chargebackAmount,
      chargebackOutput,
      chargebackAllowedBy,
      chargebackRemittanceInfo,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
