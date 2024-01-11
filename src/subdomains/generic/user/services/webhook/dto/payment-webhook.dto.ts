import { ApiProperty } from '@nestjs/swagger';
import { TransactionDto } from 'src/subdomains/core/history/dto/output/transaction.dto';
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

export class PaymentWebhookData extends TransactionDto {
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
