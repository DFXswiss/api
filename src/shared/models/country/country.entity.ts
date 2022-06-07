import { Entity, Column } from 'typeorm';
import { IEntity } from '../entity';

@Entity()
export class Country extends IEntity {
  @Column({ unique: true, length: 10 })
  symbol: string;

  @Column({ length: 256 })
  name: string;

  @Column({ default: true })
  enable: boolean;

  @Column({ default: true })
  ipEnable: boolean;
}
