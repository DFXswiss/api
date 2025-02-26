import { ApiProperty } from '@nestjs/swagger';
import { BuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { SwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/swap-payment-info.dto';
import { SellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-payment-info.dto';
import { CustodyOrderStatus, CustodyOrderType } from '../../enums/custody';

export class CustodyOrderResponseDto {
  @ApiProperty({
    description: 'Type of your requested action',
  })
  type: CustodyOrderType;

  @ApiProperty({
    description: 'ID of your action',
  })
  orderId: number;

  @ApiProperty({
    description: 'Type of your requested action',
  })
  status: CustodyOrderStatus;

  @ApiProperty({
    description: 'Payment info of your requested action',
  })
  paymentInfo: BuyPaymentInfoDto | SellPaymentInfoDto | SwapPaymentInfoDto;
}
