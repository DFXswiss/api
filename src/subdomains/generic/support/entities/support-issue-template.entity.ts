import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class SupportIssueTemplate extends IEntity {
  @Index()
  @Column({ length: 256 })
  name: string;

  @Column({ type: 'text' })
  contentDe: string;

  @Column({ type: 'text', nullable: true })
  contentEn?: string | null;

  @Column({ type: 'int' })
  authorId: number;

  @Column({ length: 256 })
  authorMail: string;
}
