import { Body, Controller, Get, Put, UseGuards, Post, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { CryptoRouteService } from './crypto-route.service';
import { CryptoRouteDto } from './dto/crypto-route.dto';
import { CryptoRoute } from './crypto-route.entity';
import { CreateCryptoRouteDto } from './dto/create-crypto-route.dto';
import { UpdateCryptoRouteDto } from './dto/update-crypto-route.dto';
import { Deposit } from '../deposit/deposit.entity';
import { Staking } from '../staking/staking.entity';
import { StakingDto } from '../staking/dto/staking.dto';
import { StakingRepository } from '../staking/staking.repository';
import { StakingService } from '../staking/staking.service';
import { In } from 'typeorm';
import { CryptoHistoryDto } from './dto/crypto-history.dto';
import { Config } from 'src/config/config';
import { MinDeposit } from '../deposit/dto/min-deposit.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoPaymentInfoDto } from './dto/crypto-payment-info.dto';
import { GetCryptoPaymentInfoDto } from './dto/get-crypto-payment-info.dto';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyType } from 'src/subdomains/core/buy-crypto/route/dto/buy-type.enum';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';

@ApiTags('CryptoRoute')
@Controller('cryptoRoute')
export class CryptoRouteController {
  constructor(
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly userService: UserService,
    private readonly stakingRepo: StakingRepository,
    private readonly stakingService: StakingService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly paymentInfoService: PaymentInfoService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getAllCrypto(@GetJwt() jwt: JwtPayload): Promise<CryptoRouteDto[]> {
    return this.cryptoRouteService.getUserCryptos(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async createCrypto(
    @GetJwt() jwt: JwtPayload,
    @Body() createCryptoDto: CreateCryptoRouteDto,
  ): Promise<CryptoRouteDto> {
    return this.cryptoRouteService.createCrypto(jwt.id, createCryptoDto).then((b) => this.toDto(jwt.id, b));
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: CryptoPaymentInfoDto })
  async createCryptoWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetCryptoPaymentInfoDto,
  ): Promise<CryptoPaymentInfoDto> {
    await this.paymentInfoService.cryptoPaymentInfoCheck(dto);
    return this.cryptoRouteService
      .createCrypto(jwt.id, { ...dto, type: BuyType.WALLET }, true)
      .then((crypto) => this.toPaymentInfoDto(jwt.id, crypto));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async updateCryptoRoute(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() updateCryptoDto: UpdateCryptoRouteDto,
  ): Promise<CryptoRouteDto> {
    return this.cryptoRouteService.updateCrypto(jwt.id, +id, updateCryptoDto).then((b) => this.toDto(jwt.id, b));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getCryptoRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CryptoHistoryDto[]> {
    return this.buyCryptoService.getCryptoHistory(jwt.id, +id);
  }

  // --- DTO --- //
  private async toDtoList(userId: number, cryptos: CryptoRoute[]): Promise<CryptoRouteDto[]> {
    const fees = await this.getFees(userId);

    const stakingRoutes = await this.stakingRepo.find({ deposit: { id: In(cryptos.map((b) => b.targetDeposit?.id)) } });
    return Promise.all(cryptos.map((b) => this.toDto(userId, b, fees, stakingRoutes)));
  }

  private async toDto(
    userId: number,
    crypto: CryptoRoute,
    fees?: { fee: number; refBonus: number },
    stakingRoutes?: Staking[],
  ): Promise<CryptoRouteDto> {
    fees ??= await this.getFees(userId);

    return {
      ...crypto,
      asset: AssetDtoMapper.entityToDto(crypto.asset),
      type: crypto.targetDeposit != null ? BuyType.STAKING : BuyType.WALLET,
      blockchain: crypto.deposit.blockchain,
      staking: await this.getStaking(userId, crypto.targetDeposit, stakingRoutes),
      ...fees,
      minDeposits: this.getMinDeposits(crypto.deposit.blockchain),
    };
  }

  private async toPaymentInfoDto(userId: number, cryptoRoute: CryptoRoute): Promise<CryptoPaymentInfoDto> {
    return {
      depositAddress: cryptoRoute.deposit.address,
      ...(await this.getFees(userId)),
      minDeposits: this.getMinDeposits(cryptoRoute.deposit.blockchain),
    };
  }

  // --- HELPER-METHODS --- //
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

  private getMinDeposits(blockchain: Blockchain): MinDeposit[] {
    switch (blockchain) {
      case Blockchain.BITCOIN:
        return Config.transformToMinDeposit(Config.blockchain.default.minDeposit.Bitcoin);
      case Blockchain.DEFICHAIN:
        return Config.transformToMinDeposit(Config.blockchain.default.minDeposit.DeFiChain, 'USD');
    }
  }

  async getFees(userId: number): Promise<{ fee: number; refBonus: number }> {
    return this.userService.getUserCryptoFee(userId);
  }
}
