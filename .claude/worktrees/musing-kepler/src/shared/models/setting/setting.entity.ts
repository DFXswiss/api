import { Column, Entity } from 'typeorm';
import { IEntity } from '../entity';

@Entity()
export class Setting extends IEntity {
  @Column({ length: 256, unique: true })
  key: string;

  @Column({ length: 'MAX' })
  value: string;
}
