import { IEntity } from 'src/shared/models/entity';
import { Entity, OneToOne, Column } from 'typeorm';
import { BuyFiat } from '../../../core/sell-crypto/buy-fiat/buy-fiat.entity';

@Entity()
export class FiatOutput extends IEntity {
  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.fiatOutput, { nullable: true })
  buyFiat?: BuyFiat;

  @Column({ length: 256, nullable: true })
  reason: string;
}
