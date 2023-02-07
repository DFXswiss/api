import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity } from 'src/shared/models/entity';
import { Entity, Column, OneToOne, Index } from 'typeorm';
import { DepositRoute } from '../route/deposit-route.entity';

@Entity()
@Index((deposit: Deposit) => [deposit.address, deposit.blockchain], { unique: true })
export class Deposit extends IEntity {
  @Column({ length: 256 })
  address: string;

  @OneToOne(() => DepositRoute, (route) => route.deposit, { nullable: true })
  route: DepositRoute;

  @Column({ length: 256, default: Blockchain.DEFICHAIN })
  blockchain: Blockchain;

  @Column({ length: 256, nullable: true })
  key: string;

  //*** FACTORY METHODS ***//

  static create(address: string, blockchain: Blockchain, key?: string): Deposit {
    const entity = new Deposit();

    entity.address = address;
    entity.blockchain = blockchain;
    entity.key = key;

    return entity;
  }
}
