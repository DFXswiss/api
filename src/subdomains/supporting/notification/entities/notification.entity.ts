import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';
import { MailContext, MailType } from '../enums';

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

  @Column({ length: 'MAX', nullable: true })
  correlationId: string;

  @Column({ length: 'MAX', default: '-' }) // TODO: replace default with nullable: false
  data: string;

  @Column({ type: 'datetime2', nullable: true })
  lastTryDate: Date;

  @Column({ default: true }) // TODO: remove default
  isComplete: boolean;

  @Column({ length: 'MAX', nullable: true })
  error: string;

  @Column({ nullable: false, default: false })
  suppressRecurring: boolean;

  @Column({ type: 'float', nullable: true })
  debounce: number;

  isSuppressed(existingNotification: Notification): boolean {
    return (
      this.isSameNotification(existingNotification) &&
      (this.suppressRecurring || this.isDebounced(existingNotification))
    );
  }

  //*** HELPER METHODS ***//

  private isSameNotification(existingNotification: Notification): boolean {
    return existingNotification.correlationId === this.correlationId && existingNotification.context === this.context;
  }

  private isDebounced(existingNotification: Notification): boolean {
    return this.debounce && Date.now() < existingNotification.lastTryDate.getTime() + existingNotification.debounce;
  }
}
