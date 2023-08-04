import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { KycStatus, KycType } from '../user-data/user-data.entity';

@Entity()
export class Wallet extends IEntity {
  @Column({ length: 256, nullable: true })
  @Index({ unique: true, where: 'address IS NOT NULL' })
  address: string;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ length: 256, nullable: true })
  masterKey: string;

  @Column({ default: false })
  isKycClient: boolean;

  @Column({ length: 256, nullable: true })
  apiUrl: string;

  @Column({ nullable: true })
  customKyc: KycType;

  @OneToMany(() => User, (user) => user.wallet)
  users: User[];

  @Column({ length: 256, nullable: true })
  identMethod?: KycStatus;
}
