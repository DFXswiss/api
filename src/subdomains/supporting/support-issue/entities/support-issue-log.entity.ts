import { ChildEntity, Column, ManyToOne } from 'typeorm';
import { Department } from '../enums/department.enum';
import { SupportIssueInternalState } from '../enums/support-issue.enum';
import { SupportIssue } from './support-issue.entity';
import { SupportLog } from './support-log.entity';

@ChildEntity()
export class SupportIssueLog extends SupportLog {
  @ManyToOne(() => SupportIssue, (s) => s.logs, { onDelete: 'CASCADE' })
  supportIssue: SupportIssue;

  @Column({ length: 256, nullable: true })
  state?: SupportIssueInternalState;

  @Column({ length: 256, nullable: true })
  department?: Department;
}
