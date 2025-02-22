import { Country } from 'src/shared/models/country/country.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { LegalEntity, SignatoryPower, UserData } from '../user-data/user-data.entity';

@Entity()
export class Organization extends IEntity {
  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  street?: string;

  @Column({ length: 256, nullable: true })
  houseNumber?: string;

  @Column({ length: 256, nullable: true })
  location?: string;

  @Column({ length: 256, nullable: true })
  zip?: string;

  @Column({ length: 256, nullable: true })
  allBeneficialOwnersName?: string;

  @Column({ length: 256, nullable: true })
  allBeneficialOwnersDomicile?: string;

  @Column({ length: 256, nullable: true })
  accountOpenerAuthorization?: string;

  @Column({ nullable: true })
  complexOrgStructure?: boolean;

  // --- RELATIONS --- //

  @ManyToOne(() => UserData, { nullable: true })
  @JoinColumn()
  accountOpener?: UserData;

  @Column({ length: 256, nullable: true })
  legalEntity?: LegalEntity;

  @Column({ length: 256, nullable: true })
  signatoryPower?: SignatoryPower;

  @ManyToOne(() => Country, { eager: true, nullable: true })
  country?: Country;

  @OneToMany(() => UserData, (userData) => userData.organization)
  userDatas: UserData[];
}
