import { IEntity } from 'src/shared/models/entity';
import { Entity, Column } from 'typeorm';

@Entity()
export class Ip extends IEntity {
  @Column({ length: 256 })
  address: string;

  @Column({ length: 256 })
  ip: string;

  @Column({ length: 256 })
  country: string;

  @Column()
  result: boolean;
}
