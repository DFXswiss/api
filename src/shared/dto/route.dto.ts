import { ApiProperty } from '@nestjs/swagger';
import { BuyDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy.dto';
import { SellDto } from 'src/subdomains/core/sell-crypto/route/dto/sell.dto';
import { SwapDto } from '../../subdomains/core/buy-crypto/routes/swap/dto/swap.dto';

export class RouteDto {
  @ApiProperty({ type: BuyDto, isArray: true })
  buy: BuyDto[];

  @ApiProperty({ type: SellDto, isArray: true })
  sell: SellDto[];

  @ApiProperty({ type: SwapDto, isArray: true })
  swap: SwapDto[];

  @ApiProperty({ type: SwapDto, isArray: true, deprecated: true })
  crypto: SwapDto[];
}
