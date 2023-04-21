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
import { CryptoPaymentInfoDto } from './dto/crypto-payment-info.dto';
import { GetCryptoPaymentInfoDto } from './dto/get-crypto-payment-info.dto';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { HistoryDto } from 'src/subdomains/core/history/dto/history.dto';
import { DepositDtoMapper } from 'src/subdomains/supporting/address-pool/deposit/dto/deposit-dto.mapper';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';

@ApiTags('CryptoRoute')
@Controller('cryptoRoute')
export class CryptoRouteController {
  constructor(
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly userService: UserService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly paymentInfoService: PaymentInfoService,
    private readonly transactionHelper: TransactionHelper,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getAllCrypto(@GetJwt() jwt: JwtPayload): Promise<CryptoRouteDto[]> {
    return this.cryptoRouteService.getUserCryptos(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: CryptoRouteDto })
  async getCrypto(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<CryptoRouteDto> {
    return this.cryptoRouteService.get(+id).then((l) => this.toDto(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async createCrypto(@GetJwt() jwt: JwtPayload, @Body() dto: CreateCryptoRouteDto): Promise<CryptoRouteDto> {
    dto = await this.paymentInfoService.cryptoCheck(jwt, dto);
    return this.cryptoRouteService.createCrypto(jwt.id, dto).then((b) => this.toDto(jwt.id, b));
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: CryptoPaymentInfoDto })
  async createCryptoWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetCryptoPaymentInfoDto,
  ): Promise<CryptoPaymentInfoDto> {
    dto = await this.paymentInfoService.cryptoCheck(jwt, dto);
    return this.cryptoRouteService
      .createCrypto(jwt.id, { ...dto, blockchain: dto.sourceAsset.blockchain }, true)
      .then((crypto) => this.toPaymentInfoDto(jwt.id, crypto, dto));
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
  async getCryptoRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<HistoryDto[]> {
    return this.buyCryptoService.getCryptoHistory(jwt.id, +id);
  }

  // --- DTO --- //
  private async toDtoList(userId: number, cryptos: CryptoRoute[]): Promise<CryptoRouteDto[]> {
    const fee = await this.getFee(userId);

    return Promise.all(cryptos.map((b) => this.toDto(userId, b, fee)));
  }

  private async toDto(userId: number, crypto: CryptoRoute, fee?: number): Promise<CryptoRouteDto> {
    fee ??= await this.getFee(userId);
    const { minFee, minDeposit } = this.transactionHelper.getDefaultSpecs(
      crypto.deposit.blockchain,
      undefined,
      crypto.asset.blockchain,
      crypto.asset.dexName,
    );
    return {
      id: crypto.id,
      volume: crypto.volume,
      annualVolume: crypto.annualVolume,
      active: crypto.active,
      deposit: DepositDtoMapper.entityToDto(crypto.deposit),
      asset: AssetDtoMapper.entityToDto(crypto.asset),
      blockchain: crypto.deposit.blockchain,
      fee,
      minDeposits: [minDeposit],
      minFee,
    };
  }

  private async toPaymentInfoDto(
    userId: number,
    cryptoRoute: CryptoRoute,
    dto: GetCryptoPaymentInfoDto,
  ): Promise<CryptoPaymentInfoDto> {
    const fee = await this.getFee(userId);
    const { minVolume, minFee } = await this.transactionHelper.getSpecs(dto.sourceAsset, dto.asset);
    const estimatedAmount = await this.transactionHelper.getTargetEstimation(
      dto.amount,
      fee,
      minFee,
      dto.sourceAsset,
      dto.asset,
    );
    return {
      routeId: cryptoRoute.id,
      fee,
      depositAddress: cryptoRoute.deposit.address,
      blockchain: cryptoRoute.deposit.blockchain,
      minDeposit: { amount: minVolume, asset: dto.sourceAsset.dexName },
      minVolume,
      minFee,
      estimatedAmount,
    };
  }

  // --- HELPER-METHODS --- //

  async getFee(userId: number): Promise<number> {
    return this.userService.getUserCryptoFee(userId);
  }
}
