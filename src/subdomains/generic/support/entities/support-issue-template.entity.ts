import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class SupportIssueTemplate extends IEntity {
  @Index()
  @Column({ length: 256 })
  name: string;

  @Column({ length: 'MAX' })
  content: string;

  @Column({ length: 'MAX', nullable: true })
  contentEn?: string;

  @Column({ type: 'int' })
  authorId: number;

  @Column({ length: 256 })
  authorMail: string;
}
