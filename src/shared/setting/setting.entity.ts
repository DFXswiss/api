import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class Setting {
  @PrimaryColumn({ length: 256, unique: true })
  key: string;

  @Column({ length: 'MAX' })
  value: string;
}
