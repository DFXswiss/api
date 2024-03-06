import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, OneToOne } from 'typeorm';
import { BuyCrypto } from '../buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../sell-crypto/process/buy-fiat.entity';

export enum TransactionType {
  BUY_CRYPTO = 'BuyCrypto',
  BUY_FIAT = 'BuyFiat',
}

@Entity()
export class Transaction extends IEntity {
  @Column({ length: 256 })
  type: TransactionType;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.transaction, { eager: true, nullable: true })
  buyCrypto: BuyCrypto;

  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.transaction, { eager: true, nullable: true })
  buyFiat: BuyFiat;
}
