import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne, TableInheritance } from 'typeorm';
import { SupportLogType } from '../enums/support-log.enum';

@Entity()
@TableInheritance({ column: { type: 'nvarchar', name: 'type' } })
export class SupportLog extends IEntity {
  @Column({ length: 256 })
  type: SupportLogType;

  @Column({ length: 'MAX', nullable: true })
  message?: string;

  @Column({ length: 'MAX', nullable: true })
  comment?: string;

  @Column({ length: 256, nullable: true })
  clerk?: string;

  @Column({ type: 'datetime2', nullable: true })
  eventDate?: Date;

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;
}
