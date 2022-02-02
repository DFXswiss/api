import { Entity, Column } from 'typeorm';
import { IEntity } from '../entity';

@Entity()
export class Language extends IEntity {
  @Column({ unique: true, length: 10 })
  symbol: string;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 256 })
  foreignName: string;

  @Column({ default: true })
  enable: boolean;
}
