import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Department } from 'src/subdomains/supporting/support-issue/enums/department.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';

@Entity()
@Index(['userDataId'])
export class SupportNote extends IEntity {
  @Column({ nullable: true })
  userDataId?: number;

  @ManyToOne(() => UserData, { nullable: true })
  @JoinColumn({ name: 'userDataId' })
  userData?: UserData;

  @Column({ length: 256 })
  department: Department;

  @Column({ type: 'int' })
  authorId: number;

  @Column({ length: 256 })
  authorMail: string;

  @Column({ length: 256, nullable: true })
  subject?: string;

  @Column({ length: 'MAX' })
  content: string;
}
