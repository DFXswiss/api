import { ApiProperty } from '@nestjs/swagger';
import { BuyDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy.dto';
import { SellDto } from 'src/subdomains/core/sell-crypto/route/dto/sell.dto';
import { CryptoRouteDto } from '../../subdomains/core/buy-crypto/routes/crypto-route/dto/crypto-route.dto';

export class RouteDto {
  @ApiProperty({ type: BuyDto, isArray: true })
  buy: BuyDto[];

  @ApiProperty({ type: SellDto, isArray: true })
  sell: SellDto[];

  @ApiProperty({ type: CryptoRouteDto, isArray: true })
  crypto: CryptoRouteDto[];
}
