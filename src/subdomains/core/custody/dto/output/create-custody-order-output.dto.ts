import { ApiProperty } from '@nestjs/swagger';
import { BuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { SwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/swap-payment-info.dto';
import { SellPaymentInfoDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-payment-info.dto';
import { CustodyOrderStatus, CustodyOrderType } from '../../enums/custody';

export class CustodyOrderResponseDto {
  @ApiProperty({
    description: 'Type of your requested order',
  })
  type: CustodyOrderType;

  @ApiProperty({
    description: 'ID of your order',
  })
  orderId: number;

  @ApiProperty({
    description: 'Type of your requested order',
  })
  status: CustodyOrderStatus;

  @ApiProperty({
    description: 'Payment info of your requested order',
  })
  paymentInfo: BuyPaymentInfoDto | SellPaymentInfoDto | SwapPaymentInfoDto;
}
