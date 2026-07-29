import { Asset } from 'src/shared/models/asset/asset.entity';
import { Country } from 'src/shared/models/country/country.entity';
import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
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

  // Deterministic sender tie-breaker for currencies with more than one eligible send=true bank: lower
  // value is tried first. An operational input (set by Ops), never inferred from bank name in code.
  @Column({ type: 'int', default: 1000 })
  sendPriority: number = 1000;

  // Deterministic receiver tie-breaker for currencies with more than one eligible receive=true bank:
  // lower value is tried first. An operational input (set by Ops), never inferred from bank name in
  // code. Ties are broken by ascending id, so adding a bank never silently changes an existing choice.
  @Column({ type: 'int', default: 1000 })
  receivePriority: number = 1000;

  @OneToOne(() => Asset, (asset) => asset.bank, { nullable: true })
  @JoinColumn()
  asset: Asset;

  // --- ENTITY METHODS --- //

  isCountryEnabled(country: Country): boolean {
    switch (this.name) {
      case IbanBankName.FRICK:
      case IbanBankName.YAPEAL:
      case IbanBankName.OLKY:
        return country.yapealEnable;
      default:
        return true;
    }
  }

  // A Frick row used for payouts (send=true) that never receives (receive=false) can never see its own
  // booked debit come back in a camt.053 statement, so it can never reach isComplete and its reserved
  // liquidity is never released - a silent deadlock. Every other bank is trivially reconcilable.
  get isReconcilable(): boolean {
    return this.name !== IbanBankName.FRICK || !this.send || this.receive;
  }
}
