import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BankService } from '../../bank/bank/bank.service';
import { FiatOutput } from '../../fiat-output/fiat-output.entity';
import { Transaction } from '../../payment/entities/transaction.entity';
import { BankTx } from '../bank-tx/entities/bank-tx.entity';

@Entity()
export class BankTxRepeat extends IEntity {
  @OneToOne(() => BankTx, { nullable: false })
  @JoinColumn()
  bankTx: BankTx;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  sourceBankTx?: BankTx;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  chargebackBankTx?: BankTx;

  @OneToOne(() => FiatOutput, { nullable: true })
  @JoinColumn()
  chargebackOutput?: FiatOutput;

  @OneToOne(() => Transaction, { eager: true, nullable: true })
  @JoinColumn()
  transaction?: Transaction;

  @ManyToOne(() => User, { nullable: true })
  user?: User;

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

  //*** METHODS ***//

  pendingInputAmount(asset: Asset): number {
    switch (asset.blockchain) {
      case Blockchain.MAERKI_BAUMANN:
      case Blockchain.OLKYPAY:
        return BankService.isBankMatching(asset, this.bankTx.accountIban) ? this.bankTx.amount : 0;

      default:
        return 0;
    }
  }

  pendingOutputAmount(_: Asset): number {
    return 0;
  }
}
