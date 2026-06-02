import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { IEntity } from '../../../../shared/models/entity';
import { Fiat } from '../../../../shared/models/fiat/fiat.entity';
import { Buy } from '../../../core/buy-crypto/routes/buy/buy.entity';
import { UserData } from '../../../generic/user/models/user-data/user-data.entity';
import { Bank } from '../bank/bank.entity';

export enum VirtualIbanStatus {
  RESERVED = 'Reserved',
  ACTIVE = 'Active',
  EXPIRED = 'Expired',
  DEACTIVATED = 'Deactivated',
}

@Entity()
@Index((vi: VirtualIban) => [vi.currency, vi.buy], {
  unique: true,
  where: '"buyId" IS NOT NULL',
})
export class VirtualIban extends IEntity {
  @Column({ length: 34, unique: true })
  iban: string;

  @Column({ length: 12, nullable: true })
  bban?: string;

  @Column({ length: 256, nullable: true })
  yapealAccountUid?: string;

  @Index()
  @ManyToOne(() => Fiat, { nullable: false, eager: true })
  currency: Fiat;

  @Column({ default: true })
  active: boolean;

  @Column({ length: 256, nullable: true })
  status?: VirtualIbanStatus;

  @Index()
  @ManyToOne(() => UserData, (userData) => userData.virtualIbans, { nullable: false })
  userData: UserData;

  @Index()
  @ManyToOne(() => Bank, { nullable: false, eager: true })
  bank: Bank;

  @Column({ type: 'timestamp', nullable: true })
  reservedUntil?: Date;

  @Column({ type: 'timestamp', nullable: true })
  activatedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  deactivatedAt?: Date;

  @Column({ length: 256, nullable: true })
  label?: string;

  @Index()
  @ManyToOne(() => Buy, { nullable: true, eager: true })
  buy?: Buy;
}
