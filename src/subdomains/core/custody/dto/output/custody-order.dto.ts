import { ApiProperty } from '@nestjs/swagger';
import { CustodyOrderStatus, CustodyOrderType } from '../../enums/custody';
import { CustodyOrderResponseDto } from './custody-order-response.dto';

export class CustodyOrderDto {
  @ApiProperty({ description: 'Type of your requested order' })
  type: CustodyOrderType;

  @ApiProperty({ description: 'ID of your order' })
  orderId: number;

  @ApiProperty({ description: 'Type of your requested order' })
  status: CustodyOrderStatus;

  @ApiProperty({ description: 'Payment info of your requested order' })
  paymentInfo: CustodyOrderResponseDto;
}
