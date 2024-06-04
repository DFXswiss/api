import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, OneToOne } from 'typeorm';
import { DepositRoute } from '../route/deposit-route.entity';

@Entity()
@Index((deposit: Deposit) => [deposit.accountIndex, deposit.blockchains], {
  unique: true,
  where: 'accountIndex IS NOT NULL',
})
export class Deposit extends IEntity {
  @Column({ length: 256, unique: true })
  address: string;

  @OneToOne(() => DepositRoute, (route) => route.deposit, { nullable: true })
  route: DepositRoute;

  @Column({ length: 256 })
  blockchains: string; // semicolon separated

  @Column({ nullable: true })
  accountIndex?: number;

  get blockchainList(): Blockchain[] {
    return this.blockchains.split(';') as Blockchain[];
  }

  // --- FACTORY METHODS --- //

  static create(address: string, blockchains: Blockchain[], accountIndex?: number): Deposit {
    const entity = new Deposit();

    entity.address = address;
    entity.blockchains = blockchains.join(';');
    entity.accountIndex = accountIndex;

    return entity;
  }
}
