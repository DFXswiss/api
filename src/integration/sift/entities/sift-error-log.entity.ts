import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne } from 'typeorm';

@Entity()
export class SiftErrorLog extends IEntity {
  @Column({ length: 256 })
  eventType: string;

  @ManyToOne(() => User, { nullable: true })
  user?: User;

  @Column({ type: 'int', nullable: true })
  httpStatusCode?: number;

  @Column({ type: 'text' })
  errorMessage: string;

  @Column({ type: 'int' })
  duration: number;

  @Column({ default: false })
  isTimeout: boolean;

  @Column({ type: 'text', nullable: true })
  requestPayload?: string;
}
