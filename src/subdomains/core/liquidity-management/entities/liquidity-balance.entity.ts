import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';

@Entity()
export class LiquidityBalance extends IEntity {
  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset?: Asset;

  @Column({ type: 'float', nullable: true })
  amount?: number;

  @Column({ type: 'float', nullable: true })
  availableAmount?: number;

  @Column({ default: true })
  isDfxOwned: boolean;

  // --- FACTORY METHODS --- //

  static create(target: Asset, amount: number, availableAmount?: number): LiquidityBalance {
    const balance = new LiquidityBalance();

    balance.asset = target;
    balance.amount = amount;
    balance.availableAmount = availableAmount ?? amount;

    return balance;
  }

  // --- PUBLIC API --- //

  updateBalance(amount: number, availableAmount?: number): this {
    this.amount = amount;
    this.availableAmount = availableAmount ?? amount;

    return this;
  }
}
