import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

@Entity()
export class SiftErrorLog extends IEntity {
  @Column({ length: 256 })
  eventType: string;

  @Column({ type: 'int', nullable: true })
  userId?: number;

  @Column({ type: 'int', nullable: true })
  httpStatusCode?: number;

  @Column({ length: 'MAX' })
  errorMessage: string;

  @Column({ type: 'int' })
  duration: number;

  @Column({ default: false })
  isTimeout: boolean;

  @Column({ length: 'MAX', nullable: true })
  requestPayload?: string;
}
