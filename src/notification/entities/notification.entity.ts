import { IEntity } from 'src/shared/models/entity';
import { Entity, Column } from 'typeorm';
import { MailContext, NotificationType } from '../enums';

export interface NotificationOptions {
  suppressRecurring?: boolean;
  debounce?: number; // debounce time in milliseconds
}

@Entity()
export class Notification extends IEntity {
  @Column({ length: 256, nullable: false })
  type: NotificationType;

  @Column({ length: 256, nullable: false })
  context: MailContext;

  @Column({ length: 256, nullable: false })
  correlationId: string;

  @Column({ nullable: false, default: false })
  suppressRecurring: boolean;

  @Column({ type: 'float', nullable: true })
  debounce: number;

  @Column({ type: 'int', nullable: true })
  recurringAttempts: number;

  constructor(options: NotificationOptions) {
    super();

    this.suppressRecurring = options?.suppressRecurring ?? this.suppressRecurring;
    this.debounce = options?.debounce ?? this.debounce;
  }

  shouldContinueGiven(existingNotification: Notification): boolean {
    return true;
  }

  toBePersisted(): boolean {
    return true;
  }
}
