import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, ManyToOne, UpdateDateColumn } from 'typeorm';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { User } from 'src/user/models/user/user.entity';

@Entity()
@Index('ibanAssetUser', (buy: Buy) => [buy.iban, buy.asset, buy.user], { unique: true })
export class Buy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256, unique: true })
  bankUsage: string;

  @Column({ default: true })
  active: boolean;

  @ManyToOne(() => User, (user) => user.buys)
  user: User;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
