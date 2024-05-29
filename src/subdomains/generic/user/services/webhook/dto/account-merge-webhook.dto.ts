import { ApiProperty } from '@nestjs/swagger';
import { WebhookDto, WebhookType } from './webhook.dto';

export class AccountMergeWebhookData {
  @ApiProperty()
  master: number;

  @ApiProperty()
  slave: number;
}

export class AccountMergeWebhookDto extends WebhookDto<AccountMergeWebhookData> {
  @ApiProperty({ enum: [WebhookType.ACCOUNT_MERGE] })
  type: WebhookType.ACCOUNT_MERGE;

  @ApiProperty({ type: AccountMergeWebhookData })
  data: AccountMergeWebhookData;
}
