import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';

export enum AssetType {
  COIN = 'Coin',
  DCT = 'DCT',
  DAT = 'DAT',
}

@Entity()
export class Asset {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 34 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  type: AssetType;

  @Column({ type: 'tinyint', default: 1 })
  buyable: boolean;

  @Column({ type: 'tinyint', default: 1 })
  sellable: boolean;
}
