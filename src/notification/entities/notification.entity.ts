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

  @Column({ type: 'datetime2', nullable: false })
  sendDate: Date;

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

    this.sendDate = new Date();
  }

  shouldContinueGiven(existingNotification: Notification): boolean {
    if (this.isSameNotification(existingNotification)) {
      if (this.suppressRecurring) return false;
      if (this.debounce) {
        return Date.now() > existingNotification.sendDate.getTime() + existingNotification.debounce;
      }
    }

    return true;
  }

  toBePersisted(): boolean {
    return !!(this.suppressRecurring || this.debounce);
  }

  //*** HELPER METHODS ***//

  private isSameNotification(existingNotification: Notification): boolean {
    return existingNotification.correlationId === this.correlationId && existingNotification.context === this.context;
  }
}
