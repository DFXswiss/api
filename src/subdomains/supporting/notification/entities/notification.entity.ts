import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';
import { MailContext, MailType } from '../enums';
import { NotificationSuppressedException } from '../exceptions/notification-suppressed.exception';

export interface NotificationMetadata {
  context: MailContext;
  correlationId: string;
}

export interface NotificationOptions {
  suppressRecurring?: boolean;
  debounce?: number; // debounce time in milliseconds
}

@Entity()
export class Notification extends IEntity {
  @Column({ length: 256, nullable: false })
  type: MailType;

  @Column({ length: 256, nullable: false })
  context: MailContext;

  @Column({ length: 'MAX', nullable: false })
  correlationId: string;

  @Column({ length: 'MAX', default: '-' })
  data: string;

  @Column({ type: 'datetime2', nullable: false })
  lastTryDate: Date;

  @Column({ default: false })
  isComplete: boolean;

  @Column({ length: 'MAX', nullable: true })
  error: string;

  @Column({ nullable: false, default: false })
  suppressRecurring: boolean;

  @Column({ type: 'float', nullable: true })
  debounce: number;

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

  shouldBePersisted(): boolean {
    if (!this.hasMandatoryParams()) return false;

    return !!(this.suppressRecurring || this.debounce);
  }

  //*** HELPER METHODS ***//

  private isSameNotification(existingNotification: Notification): boolean {
    return existingNotification.correlationId === this.correlationId && existingNotification.context === this.context;
  }

  private isDebounced(existingNotification: Notification): boolean {
    return this.debounce && Date.now() < existingNotification.lastTryDate.getTime() + existingNotification.debounce;
  }

  private hasMandatoryParams(): boolean {
    return !!(this.type && this.context && this.correlationId);
  }
}
