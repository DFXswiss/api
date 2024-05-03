import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { SupportIssue } from './support-issue.entity';

export enum SupportMessageAuthor {
  CT = 'CT',
  BW = 'BW',
  CUSTOMER = 'Customer'
}

@Entity()
export class SupportMessage extends IEntity {
  @Column({ length: 256, nullable: true })
  author: SupportMessageAuthor;

  @Column({ length: 'MAX', nullable: true })
  message: string;

  @Column({ length: 256, nullable: true })
  fileUrl: string;

  @ManyToOne(() => SupportIssue, (supportIssue) => supportIssue.messages, { nullable: false, eager: true })
  supportIssue: SupportIssue;
}
