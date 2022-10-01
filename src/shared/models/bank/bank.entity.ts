import { Entity, Column, Index } from 'typeorm';
import { IEntity } from '../entity';

@Entity()
@Index('ibanBic', (bank: Bank) => [bank.iban, bank.bic], { unique: true })
export class Bank extends IEntity {
  @Column({ unique: true, length: 256 })
  name: string;

  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256 })
  bic: string;

  @Column({ default: true })
  enable: boolean;
}
