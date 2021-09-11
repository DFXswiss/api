import { UserData } from 'src/userData/userData.entity';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';

@Entity()
@Index('nameLocation', (bankData: BankData) => [bankData.name, bankData.location], { unique: true })
export class BankData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 256 })
  location: string;

  @Column({ length: 256, nullable: true })
  country: string;

  @ManyToOne(() => UserData)
  @JoinColumn()
  userData: UserData;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
