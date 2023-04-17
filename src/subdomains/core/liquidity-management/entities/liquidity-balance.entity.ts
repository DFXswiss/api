import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Column, Entity, ManyToOne } from 'typeorm';

@Entity()
export class LiquidityBalance extends IEntity {
  @ManyToOne(() => Asset, { eager: true, nullable: true })
  asset: Asset;

  @ManyToOne(() => Fiat, { eager: true, nullable: true })
  fiat: Fiat;

  @Column({ type: 'float', nullable: true })
  amount: number;

  //*** FACTORY METHODS ***//

  static create(target: Asset | Fiat, amount: number): LiquidityBalance {
    const balance = new LiquidityBalance();

    if (target instanceof Asset) {
      balance.asset = target;
    } else if (target instanceof Fiat) {
      balance.fiat = target;
    } else {
      throw new Error('Could not create LiquidityBalance. Only Asset or Fiat supported');
    }

    balance.amount = amount;

    return balance;
  }

  //*** PUBLIC API ***//

  updateBalance(amount: number): this {
    this.amount = amount;

    return this;
  }

  //*** GETTER ***//

  get target(): Asset | Fiat {
    return this.asset ?? this.fiat;
  }

  get targetName(): string {
    return this.asset?.uniqueName ?? this.fiat.name;
  }
}
