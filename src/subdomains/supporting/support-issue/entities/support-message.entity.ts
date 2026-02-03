import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { SupportIssue } from './support-issue.entity';

export const CustomerAuthor = 'Customer';
export const AutoResponder = 'AutoResponder';

@Entity()
export class SupportMessage extends IEntity {
  @Column({ length: 256 })
  author: string;

  @Column({ length: 'MAX', nullable: true })
  message?: string;

  @Column({ length: 256, nullable: true })
  fileUrl?: string;

  @ManyToOne(() => SupportIssue, (issue) => issue.messages, { nullable: false, eager: true })
  issue: SupportIssue;

  get userData(): UserData {
    return this.issue.userData;
  }

  get fileName(): string {
    const fileName = this.fileUrl?.split('/').pop();
    return fileName ? decodeURIComponent(fileName) : undefined;
  }
}
