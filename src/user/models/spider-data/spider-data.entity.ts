import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { UserData } from '../userData/userData.entity';

@Entity()
export class SpiderData extends IEntity {
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
