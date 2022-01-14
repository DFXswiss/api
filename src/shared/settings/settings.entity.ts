import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class Settings {
  @PrimaryColumn({ length: 256, unique: true })
  key: string;

  @Column({ length: 256 })
  value: string;
}
