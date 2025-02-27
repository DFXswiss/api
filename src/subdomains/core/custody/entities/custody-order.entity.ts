import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { CustodyOrderStatus, CustodyActionType as CustodyOrderType } from '../enums/custody';

@Entity()
export class CustodyOrder extends IEntity {
  @Column({ nullable: false })
  type: CustodyOrderType;

  @ManyToOne(() => User, (user) => user.custodyOrders, { nullable: false })
  user: User;

  @OneToOne(() => TransactionRequest, (transactionRequest) => transactionRequest.custodyOrder, {
    nullable: false,
  })
  @JoinColumn()
  transactionRequest: TransactionRequest;

  @Column({ nullable: false, default: CustodyOrderStatus.CREATED })
  status: CustodyOrderStatus;

  confirm(): UpdateResult<CustodyOrder> {
    const update: Partial<CustodyOrder> = {
      status: CustodyOrderStatus.CONFIRMED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  approve(): UpdateResult<CustodyOrder> {
    const update: Partial<CustodyOrder> = {
      status: CustodyOrderStatus.APPROVED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
