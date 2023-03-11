import { Entity, Column } from 'typeorm';
import { IEntity } from '../entity';

@Entity()
export class Fiat extends IEntity {
  @Column({ unique: true, length: 256 })
  name: string;

  @Column({ default: false })
  buyable: boolean;

  @Column({ default: false })
  sellable: boolean;
}
