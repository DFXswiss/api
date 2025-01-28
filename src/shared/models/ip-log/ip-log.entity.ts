import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';

@Entity()
export class IpLog extends IEntity {
  @Column({ length: 256 })
  address: string;

  @Column({ length: 256 })
  ip: string;

  @Column({ length: 256, nullable: true })
  country?: string;

  @Column({ length: 256 })
  url: string;

  @Column({ length: 256, nullable: true })
  specialCode: string;

  @Column()
  result: boolean;

  @ManyToOne(() => User, { nullable: true })
  user?: User;
}
