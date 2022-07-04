import { IEntity } from 'src/shared/models/entity';
import { Entity, Column, OneToOne } from 'typeorm';
import { DepositRoute } from '../route/deposit-route.entity';

@Entity()
export class Deposit extends IEntity {
  @Column({ unique: true, length: 256 })
  address: string;

  @OneToOne(() => DepositRoute, (route) => route.deposit, { nullable: true })
  route: DepositRoute;


  //TODO: Chain
  @Column({ unique: true, length: 256 })
  chain: string;

}
