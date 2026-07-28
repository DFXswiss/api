import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { Buy } from '../../buy-crypto/routes/buy/buy.entity';
import { Swap } from '../../buy-crypto/routes/swap/swap.entity';
import { Sell } from '../../sell-crypto/route/sell.entity';
import { CustodyOrderStatus, CustodyOrderType } from '../enums/custody';
import { CustodyAccount } from './custody-account.entity';
import { CustodyOrderStep } from './custody-order-step.entity';

@Entity()
export class CustodyOrder extends IEntity {
  @Column({ nullable: false })
  type: CustodyOrderType;

  @Column({ nullable: false, default: CustodyOrderStatus.CREATED })
  status: CustodyOrderStatus;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @Column({ type: 'float', nullable: true })
  inputAmount?: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  inputAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  outputAmount?: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  amountInChf?: number; // unused

  @ManyToOne(() => User, (user) => user.custodyOrders, { nullable: false })
  user: User;

  @ManyToOne(() => CustodyAccount, { nullable: true })
  account?: CustodyAccount;

  @Index()
  @ManyToOne(() => UserData, { nullable: true })
  initiatedBy?: UserData;

  @ManyToOne(() => Sell, { nullable: true })
  sell?: Sell;

  @ManyToOne(() => Swap, { nullable: true })
  swap?: Swap;

  @ManyToOne(() => Buy, { nullable: true })
  buy?: Buy;

  @OneToMany(() => CustodyOrderStep, (step) => step.order, { nullable: false })
  steps: CustodyOrderStep[];

  @OneToOne(() => TransactionRequest, (transactionRequest) => transactionRequest.custodyOrder, {
    nullable: true,
    eager: true,
  })
  @JoinColumn()
  transactionRequest?: TransactionRequest;

  @OneToOne(() => Transaction, (transaction) => transaction.custodyOrder, { nullable: true, eager: true })
  @JoinColumn()
  transaction?: Transaction;

  confirm(): UpdateResult<CustodyOrder> {
    return Util.updateEntity<CustodyOrder>(this, {
      status: CustodyOrderStatus.CONFIRMED,
    });
  }

  approve(): UpdateResult<CustodyOrder> {
    return Util.updateEntity<CustodyOrder>(this, {
      status: CustodyOrderStatus.APPROVED,
    });
  }

  progress(): UpdateResult<CustodyOrder> {
    return Util.updateEntity<CustodyOrder>(this, {
      status: CustodyOrderStatus.IN_PROGRESS,
    });
  }

  /**
   * Single source of truth for the completedAt invariant: set exactly once, the first time
   * the order's status is Completed, and never overwritten afterward. `updated` (a TypeORM
   * @UpdateDateColumn) cannot serve as the valuta timestamp
   * CustodyService.calculateAccruedInterest() relies on — it is overwritten on every
   * `.save()`, including harmless re-saves of an already-Completed order. Call this after
   * `status` has been assigned, on every write path that can produce a Completed order:
   * CustodyOrderService.createOrderInternal(), updateCustodyOrderInternal(), and complete()
   * below. There must be no path that bypasses it.
   */
  applyCompletedAt(): void {
    if (this.status === CustodyOrderStatus.COMPLETED && !this.completedAt) {
      this.completedAt = new Date();
    }
  }

  complete(): UpdateResult<CustodyOrder> {
    this.status = CustodyOrderStatus.COMPLETED;
    this.applyCompletedAt();
    return Util.updateEntity<CustodyOrder>(this, { status: this.status, completedAt: this.completedAt });
  }

  fail(): UpdateResult<CustodyOrder> {
    return Util.updateEntity<CustodyOrder>(this, {
      status: CustodyOrderStatus.FAILED,
    });
  }

  reset(): UpdateResult<CustodyOrder> {
    return Util.updateEntity<CustodyOrder>(this, {
      status: CustodyOrderStatus.CREATED,
    });
  }
}
