import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index } from 'typeorm';

@Entity()
@Index((o: OlkyPayerAccount) => [o.iban, o.name, o.address, o.zip, o.city, o.country], { unique: true })
export class OlkyPayerAccount extends IEntity {
  @Column()
  iban: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  zip: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true })
  olkyPayerId: string;

  @Column({ nullable: true })
  olkyBankAccountId: string;
}
