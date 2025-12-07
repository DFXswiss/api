import { Column, Entity, ManyToOne } from 'typeorm';
import { IEntity } from '../../../../shared/models/entity';
import { Fiat } from '../../../../shared/models/fiat/fiat.entity';
import { UserData } from '../../../generic/user/models/user-data/user-data.entity';
import { Bank } from '../bank/bank.entity';

export enum VirtualIbanStatus {
  RESERVED = 'Reserved',
  ACTIVE = 'Active',
  EXPIRED = 'Expired',
  DEACTIVATED = 'Deactivated',
}

@Entity()
export class VirtualIban extends IEntity {
  @Column({ length: 34, unique: true })
  iban: string;

  @Column({ length: 12, nullable: true })
  bban?: string;

  @Column({ length: 256, nullable: true })
  yapealAccountUid?: string;

  @ManyToOne(() => Fiat, { nullable: false, eager: true })
  currency: Fiat;

  @Column({ default: true })
  active: boolean;

  @Column({ length: 256, nullable: true })
  status?: VirtualIbanStatus;

  @ManyToOne(() => UserData, (userData) => userData.virtualIbans, { nullable: false })
  userData: UserData;

  @ManyToOne(() => Bank, { nullable: false, eager: true })
  bank: Bank;

  @Column({ type: 'datetime2', nullable: true })
  reservedUntil?: Date;

  @Column({ type: 'datetime2', nullable: true })
  activatedAt?: Date;

  @Column({ type: 'datetime2', nullable: true })
  deactivatedAt?: Date;

  @Column({ length: 256, nullable: true })
  label?: string;
}
