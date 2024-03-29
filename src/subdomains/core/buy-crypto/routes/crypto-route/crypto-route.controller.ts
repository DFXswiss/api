import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpGuard } from 'src/shared/auth/ip.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { HistoryDtoDeprecated } from 'src/subdomains/core/history/dto/history.dto';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { DepositDtoMapper } from 'src/subdomains/supporting/address-pool/deposit/dto/deposit-dto.mapper';
import { CryptoPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionRequestType } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { CryptoRoute } from './crypto-route.entity';
import { CryptoRouteService } from './crypto-route.service';
import { CreateCryptoRouteDto } from './dto/create-crypto-route.dto';
import { CryptoPaymentInfoDto } from './dto/crypto-payment-info.dto';
import { CryptoQuoteDto } from './dto/crypto-quote.dto';
import { CryptoRouteDto } from './dto/crypto-route.dto';
import { GetCryptoPaymentInfoDto } from './dto/get-crypto-payment-info.dto';
import { GetCryptoQuoteDto } from './dto/get-crypto-quote.dto';
import { UpdateCryptoRouteDto } from './dto/update-crypto-route.dto';

@ApiTags('CryptoRoute')
@Controller('cryptoRoute')
export class CryptoRouteController {
  constructor(
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly userService: UserService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly paymentInfoService: PaymentInfoService,
    private readonly transactionHelper: TransactionHelper,
    private readonly cryptoService: CryptoService,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly assetService: AssetService,
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
    return this.cryptoRouteService.get(jwt.id, +id).then((l) => this.toDto(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async createCrypto(@GetJwt() jwt: JwtPayload, @Body() dto: CreateCryptoRouteDto): Promise<CryptoRouteDto> {
    dto.targetAsset ??= dto.asset;

    dto = await this.paymentInfoService.cryptoCheck(dto, jwt);
    return this.cryptoRouteService
      .createCrypto(jwt.id, dto.blockchain, dto.targetAsset)
      .then((b) => this.toDto(jwt.id, b));
  }

  // TODO: enable quote + info endpoints after refactoring (move to convert)
  @ApiExcludeEndpoint()
  @Put('/quote')
  @ApiOkResponse({ type: CryptoQuoteDto })
  async getCryptoQuote(@Body() dto: GetCryptoQuoteDto): Promise<CryptoQuoteDto> {
    const {
      amount: sourceAmount,
      sourceAsset,
      targetAsset,
      targetAmount,
      discountCode,
    } = await this.paymentInfoService.cryptoCheck(dto);

    const {
      exchangeRate,
      estimatedAmount,
      sourceAmount: amount,
      minVolume,
      minVolumeTarget,
      maxVolume,
      maxVolumeTarget,
      isValid,
      error,
      feeSource,
      feeTarget,
    } = await this.transactionHelper.getTxDetails(
      sourceAmount,
      targetAmount,
      sourceAsset,
      targetAsset,
      CryptoPaymentMethod.CRYPTO,
      CryptoPaymentMethod.CRYPTO,
      true,
      undefined,
      discountCode ? [discountCode] : [],
    );

    return {
      feeAmount: feeSource.total,
      exchangeRate,
      estimatedAmount,
      amount,
      minVolume,
      minVolumeTarget,
      maxVolume,
      maxVolumeTarget,
      fees: feeSource,
      feesTarget: feeTarget,
      isValid,
      error,
    };
  }

  @ApiExcludeEndpoint()
  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard)
  @ApiOkResponse({ type: CryptoPaymentInfoDto })
  async createCryptoWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetCryptoPaymentInfoDto,
  ): Promise<CryptoPaymentInfoDto> {
    dto = await this.paymentInfoService.cryptoCheck(dto, jwt);
    return Util.retry(
      () => this.cryptoRouteService.createCrypto(jwt.id, dto.sourceAsset.blockchain, dto.targetAsset, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    ).then((crypto) => this.toPaymentInfoDto(jwt.id, crypto, dto));
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
  async getCryptoRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<HistoryDtoDeprecated[]> {
    return this.buyCryptoService.getCryptoHistory(jwt.id, +id);
  }

  // --- DTO --- //
  private async toDtoList(userId: number, cryptos: CryptoRoute[]): Promise<CryptoRouteDto[]> {
    return Promise.all(cryptos.map((b) => this.toDto(userId, b)));
  }

  private async toDto(userId: number, crypto: CryptoRoute): Promise<CryptoRouteDto> {
    const { minDeposit } = this.transactionHelper.getDefaultSpecs(
      crypto.deposit.blockchain,
      undefined,
      crypto.asset.blockchain,
      crypto.asset.dexName,
    );

    const defaultBlockchain = this.cryptoService.getDefaultBlockchainBasedOn(crypto.user.address);
    const fee = await this.userService.getUserFee(
      userId,
      CryptoPaymentMethod.CRYPTO,
      CryptoPaymentMethod.CRYPTO,
      await this.assetService.getNativeAsset(defaultBlockchain),
      crypto.asset,
    );

    return {
      id: crypto.id,
      volume: crypto.volume,
      annualVolume: crypto.annualVolume,
      active: crypto.active,
      deposit: DepositDtoMapper.entityToDto(crypto.deposit),
      asset: AssetDtoMapper.toDto(crypto.asset),
      blockchain: crypto.deposit.blockchain,
      fee: Util.round(fee.rate * 100, Config.defaultPercentageDecimal),
      minDeposits: [minDeposit],
      minFee: { amount: fee.network, asset: 'CHF' },
    };
  }

  private async toPaymentInfoDto(
    userId: number,
    cryptoRoute: CryptoRoute,
    dto: GetCryptoPaymentInfoDto,
  ): Promise<CryptoPaymentInfoDto> {
    const user = await this.userService.getUser(userId, { userData: { users: true }, wallet: true });

    const {
      minVolume,
      minVolumeTarget,
      maxVolume,
      maxVolumeTarget,
      exchangeRate,
      rate,
      estimatedAmount,
      sourceAmount: amount,
      isValid,
      error,
      exactPrice,
      feeSource,
      feeTarget,
    } = await this.transactionHelper.getTxDetails(
      dto.amount,
      dto.targetAmount,
      dto.sourceAsset,
      dto.targetAsset,
      CryptoPaymentMethod.CRYPTO,
      CryptoPaymentMethod.CRYPTO,
      !dto.exactPrice,
      user,
    );

    const cryptoDto: CryptoPaymentInfoDto = {
      routeId: cryptoRoute.id,
      fee: Util.round(feeSource.rate * 100, Config.defaultPercentageDecimal),
      depositAddress: cryptoRoute.deposit.address,
      blockchain: cryptoRoute.deposit.blockchain,
      minDeposit: { amount: minVolume, asset: dto.sourceAsset.dexName },
      minVolume,
      minFee: feeSource.min,
      minVolumeTarget,
      minFeeTarget: feeTarget.min,
      fees: feeSource,
      feesTarget: feeTarget,
      exchangeRate,
      rate,
      exactPrice,
      estimatedAmount,
      amount,
      targetAsset: AssetDtoMapper.toDto(dto.targetAsset),
      sourceAsset: AssetDtoMapper.toDto(dto.sourceAsset),
      maxVolume,
      maxVolumeTarget,
      paymentRequest: await this.cryptoService.getPaymentRequest(
        isValid,
        dto.sourceAsset,
        cryptoRoute.deposit.address,
        amount,
      ),
      isValid,
      error,
    };

    void this.transactionRequestService.createTransactionRequest(TransactionRequestType.Convert, dto, cryptoDto);

    return cryptoDto;
  }
}
