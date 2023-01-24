import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { SellController } from '../../../core/sell-crypto/route/sell.controller';
import { SellDto } from '../../../core/sell-crypto/route/dto/sell.dto';
import { CryptoRouteController } from '../../../core/buy-crypto/routes/crypto-route/crypto-route.controller';
import { CryptoRouteDto } from '../../../core/buy-crypto/routes/crypto-route/dto/crypto-route.dto';
import { BuyDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy.dto';
import { BuyController } from 'src/subdomains/core/buy-crypto/routes/buy/buy.controller';
import { StakingDto } from 'src/subdomains/core/staking/dto/staking.dto';
import { StakingController } from 'src/subdomains/core/staking/controllers/staking.controller';

@ApiTags('route')
@Controller('route')
export class RouteController {
  constructor(
    private readonly buyController: BuyController,
    private readonly sellController: SellController,
    private readonly stakingController: StakingController,
    private readonly cryptoRouteController: CryptoRouteController,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllRoutes(
    @GetJwt() jwt: JwtPayload,
  ): Promise<{ buy: BuyDto[]; sell: SellDto[]; staking: StakingDto[]; crypto: CryptoRouteDto[] }> {
    return Promise.all([
      this.buyController.getAllBuy(jwt),
      this.sellController.getAllSell(jwt),
      this.stakingController.getAllStaking(jwt),
      this.cryptoRouteController.getAllCrypto(jwt),
    ]).then(([buy, sell, staking, crypto]) => ({ buy, sell, staking, crypto }));
  }
}
