import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
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
        return (asset.dexName === 'EUR' && this.bankTx.accountIban === 'CH6808573177975201814') ||
          (asset.dexName === 'CHF' && this.bankTx.accountIban === 'CH3408573177975200001')
          ? this.bankTx.amount
          : 0;

      case 'Olkypay':
        return this.bankTx.accountIban === 'LU116060002000005040' ? this.bankTx.amount : 0;

      default:
        return 0;
    }
  }

  pendingOutputAmount(_: Asset): number {
    return 0;
  }
}
