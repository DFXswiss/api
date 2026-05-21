import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne, TableInheritance } from 'typeorm';
import { SupportLogType } from '../enums/support-log.enum';

@Entity()
@TableInheritance({ column: { type: 'varchar', name: 'type' } })
export class SupportLog extends IEntity {
  @Column({ length: 256 })
  type: SupportLogType;

  @Column({ type: 'text', nullable: true })
  message?: string;

  @Column({ type: 'text', nullable: true })
  comment?: string;

  @Column({ length: 256, nullable: true })
  clerk?: string;

  @Column({ type: 'timestamp', nullable: true })
  eventDate?: Date;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;
}
