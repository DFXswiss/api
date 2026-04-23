import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { MrosStatus } from './mros-status.enum';

@Entity()
export class Mros extends IEntity {
  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  @Column({ length: 256 })
  status: MrosStatus;

  @Column({ type: 'datetime2', nullable: true })
  submissionDate?: Date;

  @Column({ length: 256, nullable: true })
  authorityReference?: string;

  @Column({ length: 256 })
  caseManager: string;
}
