import { IEntity } from 'src/shared/models/entity';
import { Entity, Column } from 'typeorm';
import { MailContext, NotificationType } from '../enums';
import { NotificationSuppressedException } from '../exceptions/notification-suppressed.exception';

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

  shouldAbortGiven(existingNotification: Notification): void {
    if (this.isSameNotification(existingNotification)) {
      if (this.suppressRecurring) {
        throw new NotificationSuppressedException();
      }

      if (this.isDebounced(existingNotification)) {
        throw new NotificationSuppressedException();
      }
    }
  }

  toBePersisted(): boolean {
    return !!(this.suppressRecurring || this.debounce);
  }

  //*** HELPER METHODS ***//

  private isSameNotification(existingNotification: Notification): boolean {
    return existingNotification.correlationId === this.correlationId && existingNotification.context === this.context;
  }

  private isDebounced(existingNotification: Notification): boolean {
    return this.debounce && Date.now() > existingNotification.sendDate.getTime() + existingNotification.debounce;
  }
}
