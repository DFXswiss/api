import { MailContext, MailType } from '../enums';

export interface CreateMailInput {
  type: MailType;
  context: MailContext;
  data: string;
  lastTryDate: Date;
  isComplete: boolean;
  error?: string;
}
