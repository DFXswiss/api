import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({ description: 'Source token contract address' })
  sourceChainId?: string;

  @ApiPropertyOptional({ description: 'Destination token contract address' })
  destinationChainId?: string;

  @ApiPropertyOptional({ description: 'Source EVM chain ID (e.g. 1, 56, 137)' })
  sourceEvmChainId?: number;

  @ApiPropertyOptional({ description: 'Destination EVM chain ID (e.g. 1, 56, 137)' })
  destinationEvmChainId?: number;

  @ApiPropertyOptional({ description: 'Deposit address for crypto inputs' })
  depositAddress?: string;
}

export class PaymentWebhookDto extends WebhookDto<PaymentWebhookData> {
  @ApiProperty({ enum: [WebhookType.PAYMENT] })
  type = WebhookType.PAYMENT;

  @ApiProperty({ type: PaymentWebhookData })
  declare data: PaymentWebhookData;
}
