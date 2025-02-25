import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Column, Entity, ManyToOne, OneToOne } from 'typeorm';
import { CustodyActionType } from '../enums/custody';

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

  @Column({ nullable: false, default: false })
  userConfirmation?: boolean;

  @Column({ nullable: false, default: false })
  internalConfirmation?: boolean;

  userConfirm(): UpdateResult<CustodyActionOrder> {
    const update: Partial<CustodyActionOrder> = {
      userConfirmation: true,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  internalConfirm(): UpdateResult<CustodyActionOrder> {
    const update: Partial<CustodyActionOrder> = {
      internalConfirmation: true,
    };

    Object.assign(this, update);

    return [this.id, update];
  }
}
