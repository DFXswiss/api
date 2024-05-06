import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { SupportIssue } from './support-issue.entity';

@Entity()
export class SupportMessage extends IEntity {
  @Column({ length: 256, nullable: true })
  author: string;

  @Column({ length: 'MAX', nullable: true })
  message: string;

  @Column({ length: 256, nullable: true })
  fileUrl: string;

  @ManyToOne(() => SupportIssue, (issue) => issue.messages, { nullable: false, eager: true })
  issue: SupportIssue;
}
