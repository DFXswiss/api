import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, OneToOne } from 'typeorm';
import { DepositRoute } from '../route/deposit-route.entity';

@Entity()
@Index((deposit: Deposit) => [deposit.address, deposit.blockchain], { unique: true })
@Index((deposit: Deposit) => [deposit.accountIndex, deposit.blockchain], {
  unique: true,
  where: 'accountIndex IS NOT NULL',
})
export class Deposit extends IEntity {
  @Column({ length: 256 })
  address: string;

  @OneToOne(() => DepositRoute, (route) => route.deposit, { nullable: true })
  route: DepositRoute;

  @Column({ length: 256, default: Blockchain.BITCOIN })
  blockchain: Blockchain;

  @Column({ nullable: true })
  accountIndex?: number;

  //*** FACTORY METHODS ***//

  static create(address: string, blockchain: Blockchain, accountIndex?: number): Deposit {
    const entity = new Deposit();

    entity.address = address;
    entity.blockchain = blockchain;
    entity.accountIndex = accountIndex;

    return entity;
  }
}
