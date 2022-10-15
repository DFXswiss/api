import { Entity, Column, Index } from 'typeorm';
import { IEntity } from '../entity';

export enum BankName {
  FRICK = 'Bank Frick',
  OLKY = 'Olkypay',
  MAERKI = 'Maerki Baumann',
}

@Entity()
@Index('ibanBic', (bank: Bank) => [bank.iban, bank.bic], { unique: true })
export class Bank extends IEntity {
  @Column({ length: 256 })
  name: BankName;

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
}
