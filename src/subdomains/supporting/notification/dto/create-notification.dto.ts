import { MailContext, MailType } from '../enums';

export interface CreateNotificationDto {
  type: MailType;
  context: MailContext;
  data: string;
  lastTryDate: Date;
  isComplete: boolean;
}
