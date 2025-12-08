import { ApiPropertyOptional } from '@nestjs/swagger';
import { SellPaymentInfoDto } from './sell-payment-info.dto';
import { PreparedTxDto } from './prepared-tx.dto';

export class SellPaymentInfoWithTxDto extends SellPaymentInfoDto {
  @ApiPropertyOptional({ type: PreparedTxDto, description: 'Unsigned transaction data (only if quote is valid)' })
  unsignedTx?: PreparedTxDto;
}
