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
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { DepositDtoMapper } from 'src/subdomains/supporting/address-pool/deposit/dto/deposit-dto.mapper';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionDto } from 'src/subdomains/supporting/payment/dto/transaction.dto';
import { TransactionRequestType } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionDtoMapper } from '../../history/mappers/transaction-dto.mapper';
import { BuyFiatService } from '../process/services/buy-fiat.service';
import { ConfirmDto } from './dto/confirm.dto';
import { CreateSellDto } from './dto/create-sell.dto';
import { GetSellPaymentInfoDto } from './dto/get-sell-payment-info.dto';
import { GetSellQuoteDto } from './dto/get-sell-quote.dto';
import { SellHistoryDto } from './dto/sell-history.dto';
import { SellPaymentInfoDto } from './dto/sell-payment-info.dto';
import { SellQuoteDto } from './dto/sell-quote.dto';
import { SellDto } from './dto/sell.dto';
import { UpdateSellDto } from './dto/update-sell.dto';
import { Sell } from './sell.entity';
import { SellService } from './sell.service';

@ApiTags('Sell')
@Controller('sell')
export class SellController {
  constructor(
    private readonly sellService: SellService,
    private readonly userService: UserService,
    private readonly buyFiatService: BuyFiatService,
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
  async getAllSell(@GetJwt() jwt: JwtPayload): Promise<SellDto[]> {
    return this.sellService.getUserSells(jwt.user).then((l) => this.toDtoList(l));
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: SellDto })
  async getSell(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SellDto> {
    return this.sellService.get(jwt.user, +id).then((l) => this.toDto(l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async createSell(@GetJwt() jwt: JwtPayload, @Body() dto: CreateSellDto): Promise<SellDto> {
    dto.currency ??= dto.fiat;

    dto = await this.paymentInfoService.sellCheck(dto, jwt);
    return this.sellService.createSell(jwt.user, dto).then((s) => this.toDto(s));
  }

  @Put('/quote')
  @ApiOkResponse({ type: SellQuoteDto })
  async getSellQuote(@Body() dto: GetSellQuoteDto): Promise<SellQuoteDto> {
    const {
      amount: sourceAmount,
      asset,
      currency,
      targetAmount,
      specialCode,
    } = await this.paymentInfoService.sellCheck(dto);

    const {
      rate,
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
      asset,
      currency,
      CryptoPaymentMethod.CRYPTO,
      FiatPaymentMethod.BANK,
      true,
      undefined,
      dto.wallet,
      specialCode ? [specialCode] : [],
    );

    return {
      feeAmount: feeSource.total,
      rate,
      exchangeRate,
      estimatedAmount,
      amount,
      minVolume,
      minVolumeTarget,
      fees: feeSource,
      feesTarget: feeTarget,
      maxVolume,
      maxVolumeTarget,
      priceSteps,
      isValid,
      error,
    };
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard)
  @ApiOkResponse({ type: SellPaymentInfoDto })
  async createSellWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetSellPaymentInfoDto,
  ): Promise<SellPaymentInfoDto> {
    dto = await this.paymentInfoService.sellCheck(dto, jwt);
    return Util.retry(
      () => this.sellService.createSell(jwt.user, { ...dto, blockchain: dto.asset.blockchain }, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    ).then((sell) => this.toPaymentInfoDto(jwt.user, sell, dto));
  }

  @Put('/paymentInfos/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard)
  @ApiOkResponse({ type: TransactionDto })
  async confirmSell(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmDto,
  ): Promise<TransactionDto> {
    const request = await this.transactionRequestService.getOrThrow(+id, jwt.user);
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');
    if (request.isComplete) throw new ConflictException('Transaction request is already confirmed');

    return this.sellService.confirmSell(request, dto).then((tx) => TransactionDtoMapper.mapBuyFiatTransaction(tx));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async updateSell(@GetJwt() jwt: JwtPayload, @Param('id') id: string, @Body() dto: UpdateSellDto): Promise<SellDto> {
    return this.sellService.updateSell(jwt.user, +id, dto).then((s) => this.toDto(s));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getSellRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<SellHistoryDto[]> {
    return this.buyFiatService.getSellHistory(jwt.user, +id);
  }

  // --- DTO --- //
  private async toDtoList(sell: Sell[]): Promise<SellDto[]> {
    return Promise.all(sell.map((s) => this.toDto(s)));
  }

  private async toDto(sell: Sell): Promise<SellDto> {
    const { minDeposit } = this.transactionHelper.getDefaultSpecs(
      sell.deposit.blockchainList[0],
      undefined,
      'Fiat',
      sell.fiat.name,
    );

    const defaultBlockchain = CryptoService.getDefaultBlockchainBasedOn(sell.user.address);
    const fee = await this.userService.getUserFee(
      sell.user.id,
      CryptoPaymentMethod.CRYPTO,
      FiatPaymentMethod.BANK,
      undefined,
      IbanBankName.MAERKI,
      await this.assetService.getNativeAsset(defaultBlockchain),
      sell.fiat,
    );

    return {
      id: sell.id,
      iban: sell.iban,
      active: sell.active,
      volume: sell.volume,
      annualVolume: sell.annualVolume,
      fiat: FiatDtoMapper.toDto(sell.fiat),
      currency: FiatDtoMapper.toDto(sell.fiat),
      deposit: sell.active ? DepositDtoMapper.entityToDto(sell.deposit) : undefined,
      fee: Util.round(fee.rate * 100, Config.defaultPercentageDecimal),
      blockchain: sell.deposit.blockchainList[0],
      minFee: { amount: fee.network, asset: 'CHF' },
      minDeposits: [minDeposit],
    };
  }

  private async toPaymentInfoDto(userId: number, sell: Sell, dto: GetSellPaymentInfoDto): Promise<SellPaymentInfoDto> {
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
      dto.asset,
      dto.currency,
      CryptoPaymentMethod.CRYPTO,
      FiatPaymentMethod.BANK,
      !dto.exactPrice,
      user,
    );

    const sellDto: SellPaymentInfoDto = {
      id: 0, // set during request creation
      timestamp,
      routeId: sell.id,
      fee: Util.round(feeSource.rate * 100, Config.defaultPercentageDecimal),
      depositAddress: sell.active ? sell.deposit.address : undefined,
      blockchain: dto.asset.blockchain,
      minDeposit: { amount: minVolume, asset: dto.asset.dexName },
      minVolume,
      minFee: feeSource.min,
      minVolumeTarget,
      minFeeTarget: feeTarget.min,
      fees: feeSource,
      exchangeRate,
      rate,
      exactPrice,
      priceSteps,
      estimatedAmount,
      amount,
      currency: FiatDtoMapper.toDto(dto.currency),
      beneficiary: { name: user.userData.verifiedName, iban: sell.iban },
      asset: AssetDtoMapper.toDto(dto.asset),
      maxVolume,
      maxVolumeTarget,
      feesTarget: feeTarget,
      paymentRequest: sell.active
        ? await this.cryptoService.getPaymentRequest(isValid, dto.asset, sell.deposit.address, amount)
        : undefined,
      isValid,
      error,
    };

    const transactionRequestUid = await this.transactionRequestService
      .create(TransactionRequestType.SELL, dto, sellDto, user.id)
      .then((t) => t.uid);

    return { ...sellDto, transactionRequestUid };
  }
}
