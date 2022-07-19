import { Body, Controller, Get, Put, UseGuards, Post, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserService } from 'src/user/models/user/user.service';
import { CryptoRouteService } from './crypto-route.service';
import { CryptoRouteDto } from './dto/crypto-route.dto';
import { CryptoRoute } from './crypto-route.entity';
import { CreateCryptoRouteDto } from './dto/create-crypto-route.dto';
import { UpdateCryptoRouteDto } from './dto/update-crypto-route.dto';
import { BuyType } from '../buy/dto/buy-type.enum';
import { Deposit } from '../deposit/deposit.entity';
import { Staking } from '../staking/staking.entity';
import { StakingDto } from '../staking/dto/staking.dto';
import { StakingRepository } from '../staking/staking.repository';
import { StakingService } from '../staking/staking.service';
import { In } from 'typeorm';

@ApiTags('cryptoRoute')
@Controller('cryptoRoute')
export class CryptoRouteController {
  constructor(
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly userService: UserService,
    private readonly stakingRepo: StakingRepository,
    private readonly stakingService: StakingService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllCrypto(@GetJwt() jwt: JwtPayload): Promise<CryptoRouteDto[]> {
    return this.cryptoRouteService.getUserCryptos(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createCrypto(@GetJwt() jwt: JwtPayload, @Body() createCryptoDto: CreateCryptoRouteDto): Promise<CryptoRouteDto> {
    return this.cryptoRouteService.createCrypto(jwt.id, createCryptoDto).then((b) => this.toDto(jwt.id, b));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateCryptoRoute(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() updateCryptoDto: UpdateCryptoRouteDto,
  ): Promise<CryptoRouteDto> {
    return this.cryptoRouteService.updateCrypto(jwt.id, +id, updateCryptoDto).then((b) => this.toDto(jwt.id, b));
  }

  // --- DTO --- //
  private async toDtoList(userId: number, cryptos: CryptoRoute[]): Promise<CryptoRouteDto[]> {
    const fee = await this.getFees(userId);

    const stakingRoutes = await this.stakingRepo.find({ deposit: { id: In(cryptos.map((b) => b.targetDeposit?.id)) } });
    return Promise.all(cryptos.map((b) => this.toDto(userId, b, fee, stakingRoutes)));
  }

  private async toDto(
    userId: number,
    crypto: CryptoRoute,
    fee?: number,
    stakingRoutes?: Staking[],
  ): Promise<CryptoRouteDto> {
    fee ??= await this.getFees(userId);

    return {
      type: crypto.targetDeposit != null ? BuyType.STAKING : BuyType.WALLET,
      ...crypto,
      staking: await this.getStaking(userId, crypto.targetDeposit, stakingRoutes),
      fee,
    };
  }

  private async getStaking(
    userId: number,
    deposit?: Deposit,
    stakingRoutes?: Staking[],
  ): Promise<StakingDto | undefined> {
    if (deposit == null) return undefined;

    return this.stakingService.toDto(
      userId,
      stakingRoutes
        ? stakingRoutes.find((s) => s.deposit.id === deposit.id)
        : await this.stakingRepo.findOne({ where: { deposit: deposit.id } }),
    );
  }

  async getFees(userId: number): Promise<number> {
    return this.userService.getUserCryptoFee(userId);
  }
}
