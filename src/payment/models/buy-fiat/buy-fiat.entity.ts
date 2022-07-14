import { IEntity } from 'src/shared/models/entity';
import { Entity, OneToOne, JoinColumn, ManyToOne } from 'typeorm';
import { CryptoInput } from '../crypto-input/crypto-input.entity';
import { Sell } from '../sell/sell.entity';

@Entity()
export class BuyFiat extends IEntity {
  @OneToOne(() => CryptoInput, { nullable: false })
  @JoinColumn()
  cryptoInput: CryptoInput;

  @ManyToOne(() => Sell, (sell) => sell.buyFiats, { nullable: false })
  sell: Sell;
}
