import { User } from '../../../models/user/user.entity';
import { WebhookType } from './webhook.dto';

export interface CreateWebhookInput {
  type: WebhookType;
  data: string;
  reason?: string;
  user: User;
}
