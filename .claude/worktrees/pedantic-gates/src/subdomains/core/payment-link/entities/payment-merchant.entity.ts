import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { PaymentMerchantStatus } from '../enums';

@Entity()
export class PaymentMerchant extends IEntity {
  @Column({ length: 256 })
  externalId: string;

  @Column({ length: 256 })
  status: PaymentMerchantStatus;

  @Column({ length: 'MAX' })
  data: string;

  @ManyToOne(() => User, { nullable: false })
  user: User;
}
