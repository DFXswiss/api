import { Column, Entity, PrimaryColumn } from 'typeorm';
import { IEntity } from '../entity';

@Entity()
export class Setting extends IEntity {
  @PrimaryColumn({ length: 256, unique: true })
  key: string;

  @Column({ length: 'MAX' })
  value: string;
}
