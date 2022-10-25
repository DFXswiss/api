import { IEntity } from 'src/shared/models/entity';
import { Entity, Column } from 'typeorm';
import { MailContext, NotificationType } from '../enums';
import { NotificationSuppressedException } from '../exceptions/notification-suppressed.exception';

export interface NotificationMetadata {
  context: MailContext;
  correlationId: string;
}

export interface NotificationOptions {
  suppressRecurring?: boolean;
  debounce?: number; // debounce time in milliseconds
}

export enum Banner {
  TZ = '2022/10/MailBannerTZ.png',
  CT = '2022/10/MailBannerCT.png',
  DK = '2022/10/MailBannerDK.png',
  ML = '2022/10/MailBannerML.png',
  OL = '2022/10/MailBannerOL.png',
  YO = '2022/10/MailBannerYO.png',
  TR = '2022/10/MailBannerTR.png',
  SUPPORT = '2022/10/MailBannerSupport.png',
}

@Entity()
export class Notification extends IEntity {
  @Column({ length: 256, nullable: false })
  type: NotificationType;

  @Column({ length: 256, nullable: false })
  context: MailContext;

  @Column({ length: 'MAX', nullable: false })
  correlationId: string;

  @Column({ type: 'datetime2', nullable: false })
  sendDate: Date;

  @Column({ nullable: false, default: false })
  suppressRecurring: boolean;

  @Column({ type: 'float', nullable: true })
  debounce: number;

  protected create(type: NotificationType, metadata?: NotificationMetadata, options?: NotificationOptions) {
    this.sendDate = new Date();
    this.type = type;

    this.context = metadata?.context;
    this.correlationId = metadata?.correlationId;

    this.suppressRecurring = options?.suppressRecurring;
    this.debounce = options?.debounce;
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

  shouldBePersisted(): boolean {
    if (!this.hasMandatoryParams()) return false;

    return !!(this.suppressRecurring || this.debounce);
  }

  //*** HELPER METHODS ***//

  private isSameNotification(existingNotification: Notification): boolean {
    return existingNotification.correlationId === this.correlationId && existingNotification.context === this.context;
  }

  private isDebounced(existingNotification: Notification): boolean {
    return this.debounce && Date.now() < existingNotification.sendDate.getTime() + existingNotification.debounce;
  }

  private hasMandatoryParams(): boolean {
    return !!(this.type && this.context && this.correlationId);
  }
}
