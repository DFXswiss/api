import { UserData } from 'src/user/models/userData/userData.entity';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, UpdateDateColumn, ManyToOne } from 'typeorm';

@Entity()
@Index('nameLocationIban', (bankData: BankData) => [bankData.name, bankData.location, bankData.iban], { unique: true })
export class BankData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 256, nullable: true })
  location: string;

  @Column({ length: 256, nullable: true })
  country: string;

  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256, nullable: true })
  bankName: string;

  @Column({ length: 256, nullable: true })
  bic: string;

  @ManyToOne(() => UserData)
  userData: UserData;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
