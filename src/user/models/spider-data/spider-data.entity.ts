import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserData } from '../userData/userData.entity';

@Entity()
export class SpiderData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256 })
  url: string;

  @Column({ length: 256 })
  version: string;

  @Column({ nullable: true, length: 'MAX' })
  result: string;

  @OneToOne(() => UserData, (u) => u.spiderData, { nullable: false })
  @JoinColumn()
  userData: UserData;
}
