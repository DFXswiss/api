import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/user/models/user/user.entity';
import { Entity, Column, OneToMany } from 'typeorm';

@Entity()
export class Wallet extends IEntity {
  @Column({ unique: true, length: 256 })
  address: string;

  @Column({ unique: true, length: 256 })
  signature: string;

  @Column({ length: 256, nullable: true })
  mail: string;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ default: false })
  isKycClient: boolean;

  @Column({ length: 256, nullable: true })
  apiUrl: string;

  @OneToMany(() => User, (user) => user.wallet)
  logs: User[];
}
