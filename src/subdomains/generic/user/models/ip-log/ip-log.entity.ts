import { IEntity } from 'src/shared/models/entity';
import { Entity, Column } from 'typeorm';

@Entity()
export class IpLog extends IEntity {
  @Column({ length: 256 })
  address: string;

  @Column({ length: 256 })
  ip: string;

  @Column({ length: 256, nullable: true })
  country: string;

  @Column({ length: 256 })
  url: string;

  @Column()
  result: boolean;
}
