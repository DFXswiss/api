import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { SupportIssue } from './support-issue.entity';

export const CustomerAuthor = 'Customer';

@Entity()
export class SupportMessage extends IEntity {
  @Column({ length: 256, nullable: false })
  author: string;

  @Column({ length: 'MAX', nullable: false })
  message: string;

  @Column({ length: 256, nullable: true })
  fileUrl: string;

  @ManyToOne(() => SupportIssue, (issue) => issue.messages, { nullable: false, eager: true })
  issue: SupportIssue;

  get userData(): UserData {
    return this.issue.userData;
  }

  get fileName(): string {
    return this.fileUrl?.split('/').pop();
  }
}
