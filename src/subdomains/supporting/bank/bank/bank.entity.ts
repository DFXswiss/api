import { Column, Entity, Index } from 'typeorm';
import { IEntity } from '../../../../shared/models/entity';
import { IbanBankName } from './dto/bank.dto';

@Entity()
@Index('ibanBic', (bank: Bank) => [bank.iban, bank.bic], { unique: true })
export class Bank extends IEntity {
  @Column({ length: 256 })
  name: IbanBankName;

  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256 })
  bic: string;

  @Column({ length: 256 })
  currency: string;

  @Column({ default: true })
  receive: boolean;

  @Column({ default: true })
  send: boolean;

  @Column({ default: false })
  sctInst: boolean;

  @Column({ default: true })
  amlEnabled: boolean;
}
