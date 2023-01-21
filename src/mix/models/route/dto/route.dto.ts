import { ApiProperty } from '@nestjs/swagger';
import { BuyDto } from 'src/subdomains/core/buy-crypto/route/dto/buy.dto';
import { SellDto } from 'src/subdomains/core/sell-crypto/sell/dto/sell.dto';
import { CryptoRouteDto } from '../../crypto-route/dto/crypto-route.dto';
import { StakingDto } from '../../staking/dto/staking.dto';

export class RouteDto {
  @ApiProperty({ type: BuyDto, isArray: true })
  buy: BuyDto[];

  @ApiProperty({ type: SellDto, isArray: true })
  sell: SellDto[];

  @ApiProperty({ type: StakingDto, isArray: true })
  staking: StakingDto[];

  @ApiProperty({ type: CryptoRouteDto, isArray: true })
  crypto: CryptoRouteDto[];
}
