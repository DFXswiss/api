import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
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
import { TransactionDtoMapper } from 'src/subdomains/core/history/mappers/transaction-dto.mapper';
import { ConfirmDto } from 'src/subdomains/core/sell-crypto/route/dto/confirm.dto';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { DepositDtoMapper } from 'src/subdomains/supporting/address-pool/deposit/dto/deposit-dto.mapper';
import { CryptoPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionDto } from 'src/subdomains/supporting/payment/dto/transaction.dto';
import { TransactionRequestType } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { CreateSwapDto } from './dto/create-swap.dto';
import { GetSwapPaymentInfoDto } from './dto/get-swap-payment-info.dto';
import { GetSwapQuoteDto } from './dto/get-swap-quote.dto';
import { SwapPaymentInfoDto } from './dto/swap-payment-info.dto';
import { SwapQuoteDto } from './dto/swap-quote.dto';
import { SwapDto } from './dto/swap.dto';
import { UpdateSwapDto } from './dto/update-swap.dto';
import { Swap } from './swap.entity';
import { SwapService } from './swap.service';
import { UserGuard } from 'src/shared/auth/user.guard';

@ApiTags('Swap')
@Controller('swap')
export class SwapController {
  constructor(
    private readonly swapService: SwapService,
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
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserGuard)
  @ApiExcludeEndpoint()
  async getAllSwap(@GetJwt() jwt: JwtPayload): Promise<SwapDto[]> {
    return this.swapService.getUserSwaps(jwt.user).then((l) => this.toDtoList(jwt.user, l));
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserGuard)
  @ApiOkResponse({ type: SwapDto })
  async getSwap(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SwapDto> {
    return this.swapService.get(jwt.user, +id).then((l) => this.toDto(jwt.user, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserGuard)
  @ApiExcludeEndpoint()
  async createSwap(@GetJwt() jwt: JwtPayload, @Body() dto: CreateSwapDto): Promise<SwapDto> {
    dto.targetAsset ??= dto.asset;

    dto = await this.paymentInfoService.swapCheck(dto, jwt);
    return this.swapService.createSwap(jwt.user, dto.blockchain, dto.targetAsset).then((b) => this.toDto(jwt.user, b));
  }

  @Put('/quote')
  @ApiOkResponse({ type: SwapQuoteDto })
  async getSwapQuote(@Body() dto: GetSwapQuoteDto): Promise<SwapQuoteDto> {
    const {
      amount: sourceAmount,
      sourceAsset,
      targetAsset,
      targetAmount,
      specialCode,
    } = await this.paymentInfoService.swapCheck(dto);

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
      priceSteps,
    } = await this.transactionHelper.getTxDetails(
      sourceAmount,
      targetAmount,
      sourceAsset,
      targetAsset,
      CryptoPaymentMethod.CRYPTO,
      CryptoPaymentMethod.CRYPTO,
      true,
      undefined,
      dto.wallet,
      specialCode ? [specialCode] : [],
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
      priceSteps,
      isValid,
      error,
    };
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard, UserGuard)
  @ApiOkResponse({ type: SwapPaymentInfoDto })
  async createSwapWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetSwapPaymentInfoDto,
  ): Promise<SwapPaymentInfoDto> {
    dto = await this.paymentInfoService.swapCheck(dto, jwt);
    return Util.retry(
      () => this.swapService.createSwap(jwt.user, dto.sourceAsset.blockchain, dto.targetAsset, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    ).then((crypto) => this.toPaymentInfoDto(jwt.user, crypto, dto));
  }

  @Put('/paymentInfos/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard, UserGuard)
  @ApiOkResponse({ type: TransactionDto })
  async confirmSwap(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmDto,
  ): Promise<TransactionDto> {
    const request = await this.transactionRequestService.getOrThrow(+id, jwt.user);
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');
    if (request.isComplete) throw new ConflictException('Transaction request is already confirmed');

    return this.swapService.confirmSwap(request, dto).then((tx) => TransactionDtoMapper.mapBuyCryptoTransaction(tx));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), UserGuard)
  @ApiExcludeEndpoint()
  async updateSwapRoute(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() updateCryptoDto: UpdateSwapDto,
  ): Promise<SwapDto> {
    return this.swapService.updateSwap(jwt.user, +id, updateCryptoDto).then((b) => this.toDto(jwt.user, b));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getSwapRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<HistoryDtoDeprecated[]> {
    return this.buyCryptoService.getCryptoHistory(jwt.user, +id);
  }

  // --- DTO --- //
  private async toDtoList(userId: number, cryptos: Swap[]): Promise<SwapDto[]> {
    return Promise.all(cryptos.map((b) => this.toDto(userId, b)));
  }

  private async toDto(userId: number, swap: Swap): Promise<SwapDto> {
    const { minDeposit } = this.transactionHelper.getDefaultSpecs(
      swap.deposit.blockchainList[0],
      undefined,
      swap.asset.blockchain,
      swap.asset.dexName,
    );

    const defaultBlockchain = CryptoService.getDefaultBlockchainBasedOn(swap.user.address);
    const fee = await this.userService.getUserFee(
      userId,
      CryptoPaymentMethod.CRYPTO,
      CryptoPaymentMethod.CRYPTO,
      undefined,
      undefined,
      await this.assetService.getNativeAsset(defaultBlockchain),
      swap.asset,
    );

    return {
      id: swap.id,
      volume: swap.volume,
      annualVolume: swap.annualVolume,
      active: swap.active,
      deposit: swap.active ? DepositDtoMapper.entityToDto(swap.deposit) : undefined,
      asset: AssetDtoMapper.toDto(swap.asset),
      blockchain: swap.deposit.blockchainList[0],
      fee: Util.round(fee.rate * 100, Config.defaultPercentageDecimal),
      minDeposits: [minDeposit],
      minFee: { amount: fee.network, asset: 'CHF' },
    };
  }

  private async toPaymentInfoDto(userId: number, swap: Swap, dto: GetSwapPaymentInfoDto): Promise<SwapPaymentInfoDto> {
    const user = await this.userService.getUser(userId, { userData: { users: true }, wallet: true });

    const {
      timestamp,
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
      priceSteps,
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

    const swapDto: SwapPaymentInfoDto = {
      id: 0, // set during request creation
      timestamp,
      routeId: swap.id,
      fee: Util.round(feeSource.rate * 100, Config.defaultPercentageDecimal),
      depositAddress: swap.active ? swap.deposit.address : undefined,
      blockchain: dto.sourceAsset.blockchain,
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
      priceSteps,
      estimatedAmount,
      amount,
      targetAsset: AssetDtoMapper.toDto(dto.targetAsset),
      sourceAsset: AssetDtoMapper.toDto(dto.sourceAsset),
      maxVolume,
      maxVolumeTarget,
      paymentRequest: swap.active
        ? await this.cryptoService.getPaymentRequest(isValid, dto.sourceAsset, swap.deposit.address, amount)
        : undefined,
      isValid,
      error,
    };

    await this.transactionRequestService.create(TransactionRequestType.SWAP, dto, swapDto, user.id);

    return swapDto;
  }
}
