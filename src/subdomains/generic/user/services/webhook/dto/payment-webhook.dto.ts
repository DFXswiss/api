import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookDto, WebhookType } from './webhook.dto';

export enum PaymentWebhookType {
  FIAT_CRYPTO = 'FiatCrypto',
  CRYPTO_CRYPTO = 'CryptoCrypto',
  CRYPTO_FIAT = 'CryptoFiat',
  FIAT_FIAT = 'FiatFiat',
}

export enum PaymentWebhookState {
  CREATED = 'Created',
  PROCESSING = 'Processing',
  AML_PENDING = 'AmlPending',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  RETURNED = 'Returned',
}

export class PaymentWebhookData {
  @ApiProperty({ enum: PaymentWebhookType })
  type: PaymentWebhookType;

  @ApiProperty({ enum: PaymentWebhookState })
  state: PaymentWebhookState;

  @ApiProperty()
  inputAmount: number;

  @ApiProperty()
  inputAsset: string;

  @ApiPropertyOptional()
  outputAmount: number;

  @ApiPropertyOptional()
  outputAsset: string;

  @ApiProperty()
  paymentReference: string;

  @ApiProperty()
  dfxReference: number;
}

export class PaymentWebhookDto extends WebhookDto<PaymentWebhookData> {
  @ApiProperty({ enum: [WebhookType.PAYMENT] })
  type: WebhookType.PAYMENT;

  @ApiProperty({ type: PaymentWebhookData })
  data: PaymentWebhookData;
}
