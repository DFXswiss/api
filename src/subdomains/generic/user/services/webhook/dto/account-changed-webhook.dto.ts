import { ApiProperty } from '@nestjs/swagger';
import { WebhookDto, WebhookType } from './webhook.dto';

export class AccountChangedWebhookData {
  @ApiProperty({ description: 'New account id' })
  accountId: number;
}

export class AccountChangedWebhookDto extends WebhookDto<AccountChangedWebhookData> {
  @ApiProperty({ enum: [WebhookType.ACCOUNT_CHANGED] })
  type = WebhookType.ACCOUNT_CHANGED;

  @ApiProperty({ type: AccountChangedWebhookData })
  declare data: AccountChangedWebhookData;
}
