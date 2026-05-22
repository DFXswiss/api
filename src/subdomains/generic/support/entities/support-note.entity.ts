import { IEntity } from 'src/shared/models/entity';
import { Department } from 'src/subdomains/supporting/support-issue/enums/department.enum';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';

@Entity()
export class SupportNote extends IEntity {
  @Index()
  @ManyToOne(() => UserData, { nullable: true })
  userData?: UserData;

  @Column({ length: 256 })
  department: Department;

  @Column({ type: 'int' })
  authorId: number;

  @Column({ length: 256 })
  authorMail: string;

  @Column({ length: 256, nullable: true })
  subject?: string;

  @Column({ type: 'text' })
  content: string;
}
