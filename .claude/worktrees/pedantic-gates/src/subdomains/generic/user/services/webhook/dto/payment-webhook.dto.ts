import { ApiProperty } from '@nestjs/swagger';
import { TransactionDetailDto } from 'src/subdomains/supporting/payment/dto/transaction.dto';
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

export class PaymentWebhookData extends TransactionDetailDto {
  @ApiProperty()
  dfxReference: number;
}

export class PaymentWebhookDto extends WebhookDto<PaymentWebhookData> {
  @ApiProperty({ enum: [WebhookType.PAYMENT] })
  type = WebhookType.PAYMENT;

  @ApiProperty({ type: PaymentWebhookData })
  declare data: PaymentWebhookData;
}
