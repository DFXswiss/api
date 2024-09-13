import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BankService } from '../../bank/bank/bank.service';
import { Transaction } from '../../payment/entities/transaction.entity';
import { BankTx } from '../bank-tx/entities/bank-tx.entity';

@Entity()
export class BankTxReturn extends IEntity {
  @OneToOne(() => BankTx, (bankTx) => bankTx.bankTxReturn, { nullable: false })
  @JoinColumn()
  bankTx: BankTx;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  chargebackBankTx: BankTx;

  @OneToOne(() => Transaction, { eager: true, nullable: true })
  @JoinColumn()
  transaction: Transaction;

  @Column({ length: 256, nullable: true })
  info: string;

  @Column({ type: 'float', nullable: true })
  amountInChf: number;

  @Column({ type: 'float', nullable: true })
  amountInEur: number;

  @Column({ type: 'float', nullable: true })
  amountInUsd: number;

  //*** METHODS ***//

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
}
