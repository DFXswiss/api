import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Column, Entity, ManyToOne, OneToOne } from 'typeorm';
import { CustodyActionOrderStatus, CustodyActionType } from '../enums/custody';

@Entity()
export class CustodyActionOrder extends IEntity {
  @Column({ nullable: false })
  type: CustodyActionType;

  @ManyToOne(() => User, (user) => user.custodyActionOrders, { nullable: false })
  user: User;

  @OneToOne(() => TransactionRequest, (transactionRequest) => transactionRequest.custodyActionOrder, {
    nullable: false,
  })
  transactionRequest: TransactionRequest;

  @Column({ nullable: false, default: CustodyActionOrderStatus.CREATED })
  status: CustodyActionOrderStatus;

  confirm(): UpdateResult<CustodyActionOrder> {
    const update: Partial<CustodyActionOrder> = {
      status: CustodyActionOrderStatus.CONFIRMED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  approve(): UpdateResult<CustodyActionOrder> {
    const update: Partial<CustodyActionOrder> = {
      status: CustodyActionOrderStatus.APPROVED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
