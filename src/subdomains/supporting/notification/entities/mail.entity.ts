import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';
import { MailContext, MailType } from '../enums';

@Entity()
export class Mail extends IEntity {
  @Column({ length: 256 })
  type: MailType;

  @Column({ length: 256 })
  context: MailContext;

  @Column({ length: 'MAX' })
  data: string;

  @Column({ type: 'datetime2', nullable: true })
  lastTryDate: Date;

  @Column({ default: false })
  isComplete: boolean;

  @Column({ length: 'MAX', nullable: true })
  error: string;
}
