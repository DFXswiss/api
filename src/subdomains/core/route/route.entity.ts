import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, OneToOne } from 'typeorm';
import { Buy } from '../buy-crypto/routes/buy/buy.entity';
import { Swap } from '../buy-crypto/routes/swap/swap.entity';
import { Sell } from '../sell-crypto/route/sell.entity';

@Entity()
export class Route extends IEntity {
  @Column({ length: 256, unique: true, nullable: true })
  label: string;

  // References
  @OneToOne(() => Buy, (buy) => buy.route, { nullable: true })
  buy: Buy;

  @OneToOne(() => Sell, (sell) => sell.route, { nullable: true })
  sell: Sell;

  @OneToOne(() => Swap, (swap) => swap.route, { nullable: true })
  swap: Swap;

  // --- ENTITY METHODS --- //

  get user(): User {
    return this.targetEntity?.user;
  }

  get userData(): UserData {
    return this.user?.userData;
  }

  get targetEntity(): Buy | Sell | Swap {
    return this.buy ?? this.sell ?? this.swap;
  }
}
