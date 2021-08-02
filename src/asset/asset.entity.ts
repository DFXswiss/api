import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

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

  @Column({ default: 1 })
  buyable: boolean;

  @Column({ default: 1 })
  sellable: boolean;

  @CreateDateColumn() 
  created: Date;
}
