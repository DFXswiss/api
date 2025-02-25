import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { CustodyActionType } from '../enums/custody';

@Entity()
export class CustodyActionOrder extends IEntity {
  @Column({ nullable: false })
  type: CustodyActionType;

  @ManyToOne(() => User, (user) => user.custodyActionOrders)
  user: User;

  @Column({ nullable: true, default: false })
  userConfirmation?: boolean;

  @Column({ nullable: true, default: false })
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
