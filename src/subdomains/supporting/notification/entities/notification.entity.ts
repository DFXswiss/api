import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { MailContext, MailType } from '../enums';

export interface NotificationOptions {
  suppressRecurring?: boolean;
  debounce?: number; // debounce time in milliseconds
}

@Entity()
export class Notification extends IEntity {
  @Column({ length: 256 })
  type: MailType;

  @Column({ length: 256 })
  context: MailContext;

  @Column({ type: 'text', nullable: true })
  correlationId?: string;

  @Column({ type: 'text' })
  data: string;

  @Column({ type: 'timestamp' })
  lastTryDate: Date;

  @Column({ default: false })
  isComplete: boolean;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ default: false })
  suppressRecurring: boolean;

  @Column({ type: 'float', nullable: true })
  debounce?: number;

  @ManyToOne(() => UserData, { nullable: true })
  userData?: UserData;

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
