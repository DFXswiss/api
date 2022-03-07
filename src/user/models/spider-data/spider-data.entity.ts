import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';

@Entity()
export class SpiderData extends IEntity {
  @Column({ length: 256 })
  url: string;

  @Column({ length: 256, nullable: true })
  secondUrl: string;

  @Column({ length: 'MAX', nullable: true })
  chatbotResult: string;

  @Column({ length: 256, nullable: true })
  identId: string;

  @Column({ length: 'MAX', nullable: true })
  identResult: string;

  @OneToOne(() => UserData, (u) => u.spiderData, { nullable: false })
  @JoinColumn()
  userData: UserData;
}
