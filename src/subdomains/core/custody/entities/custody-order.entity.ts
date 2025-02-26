import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { CustodyOrderStatus, CustodyOrderType } from '../enums/custody';
import { CustodyOrderStep } from './custody-order-step.entity';

@Entity()
export class CustodyOrder extends IEntity {
  @Column({ nullable: false })
  type: CustodyOrderType;

  @ManyToOne(() => User, (user) => user.custodyOrders, { nullable: false })
  user: User;

  @OneToOne(() => TransactionRequest, (transactionRequest) => transactionRequest.custodyOrder, {
    nullable: false,
    eager: true,
  })
  @JoinColumn()
  transactionRequest: TransactionRequest;

  @Column({ nullable: false, default: CustodyOrderStatus.CREATED })
  status: CustodyOrderStatus;

  @OneToMany(() => CustodyOrderStep, (step) => step.order, { nullable: false })
  steps: CustodyOrderStep;

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

  complete(): UpdateResult<CustodyOrder> {
    return Util.updateEntity<CustodyOrder>(this, {
      status: CustodyOrderStatus.COMPLETED,
    });
  }
}
