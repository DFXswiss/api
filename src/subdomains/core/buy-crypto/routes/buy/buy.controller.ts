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
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpGuard } from 'src/shared/auth/ip.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionRequestStatus } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { BuyCryptoService } from '../../process/services/buy-crypto.service';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { BuyHistoryDto } from './dto/buy-history.dto';
import { BuyPaymentInfoDto } from './dto/buy-payment-info.dto';
import { BuyQuoteDto } from './dto/buy-quote.dto';
import { BuyDto } from './dto/buy.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { GetBuyPaymentInfoDto } from './dto/get-buy-payment-info.dto';
import { GetBuyQuoteDto } from './dto/get-buy-quote.dto';
import { PdfDto } from './dto/pdf.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@ApiTags('Buy')
@Controller('buy')
export class BuyController {
  constructor(
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly paymentInfoService: PaymentInfoService,
    private readonly transactionHelper: TransactionHelper,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly fiatService: FiatService,
    private readonly swissQrService: SwissQRService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  async getAllBuy(@GetJwt() jwt: JwtPayload): Promise<BuyDto[]> {
    return this.buyService.getUserBuys(jwt.user).then((l) => this.toDtoList(jwt.user, l));
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOkResponse({ type: BuyDto })
  async getBuy(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<BuyDto> {
    return this.buyService.get(jwt.account, +id).then((l) => this.toDto(jwt.user, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiExcludeEndpoint()
  async createBuy(@GetJwt() jwt: JwtPayload, @Body() dto: CreateBuyDto): Promise<BuyDto> {
    dto = await this.paymentInfoService.buyCheck(dto, jwt);
    return this.buyService.createBuy(jwt.user, jwt.address, dto).then((b) => this.toDto(jwt.user, b));
  }

  @Put('/quote')
  @ApiOkResponse({ type: BuyQuoteDto })
  async getBuyQuote(@Body() dto: GetBuyQuoteDto): Promise<BuyQuoteDto> {
    const {
      amount: sourceAmount,
      currency,
      asset,
      targetAmount,
      paymentMethod,
      specialCode,
    } = await this.paymentInfoService.buyCheck(dto);

    const {
      rate,
      exchangeRate,
      estimatedAmount,
      sourceAmount: amount,
      minVolume,
      minVolumeTarget,
      maxVolume,
      maxVolumeTarget,
      feeSource,
      feeTarget,
      isValid,
      error,
      priceSteps,
    } = await this.transactionHelper.getTxDetails(
      sourceAmount,
      targetAmount,
      currency,
      asset,
      paymentMethod,
      CryptoPaymentMethod.CRYPTO,
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
      maxVolume,
      minVolumeTarget,
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
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), IpGuard, UserActiveGuard())
  @ApiOkResponse({ type: BuyPaymentInfoDto })
  async createBuyWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetBuyPaymentInfoDto,
  ): Promise<BuyPaymentInfoDto> {
    return this.buyService.createBuyPaymentInfo(jwt, dto);
  }

  @Put('/paymentInfos/:id/invoice')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), IpGuard, UserActiveGuard())
  @ApiOkResponse({ type: PdfDto })
  async generateInvoicePDF(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<PdfDto> {
    const request = await this.transactionRequestService.getOrThrow(+id, jwt.user);
    if (!request.userData.isDataComplete) throw new BadRequestException('User data is not complete');
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');
    if (request.isComplete) throw new ConflictException('Transaction request is already confirmed');

    const buy = await this.buyService.get(jwt.account, request.routeId);
    const currency = await this.fiatService.getFiat(request.sourceId);
    const bankInfo = await this.buyService.getBankInfo({
      amount: request.amount,
      currency: currency.name,
      paymentMethod: request.sourcePaymentMethod as FiatPaymentMethod,
      userData: request.userData,
    });

    if (!Config.invoice.currencies.includes(currency.name)) {
      throw new Error('PDF invoice is only available for CHF and EUR transactions');
    }

    return {
      pdfData: await this.swissQrService.createInvoiceFromRequest(
        request.amount,
        currency.name,
        buy.bankUsage,
        bankInfo,
        request,
      ),
    };
  }

  @Put('/paymentInfos/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), IpGuard)
  @ApiOkResponse()
  async confirmBuy(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<void> {
    const request = await this.transactionRequestService.getOrThrow(+id, jwt.user);
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');
    if ([TransactionRequestStatus.COMPLETED, TransactionRequestStatus.WAITING_FOR_PAYMENT].includes(request.status))
      throw new ConflictException('Transaction request is already confirmed');
    if (Util.daysDiff(request.created) >= Config.txRequestWaitingExpiryDays)
      throw new BadRequestException('Transaction request is expired');

    await this.transactionRequestService.confirmTransactionRequest(request);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiExcludeEndpoint()
  async updateBuyRoute(@GetJwt() jwt: JwtPayload, @Param('id') id: string, @Body() dto: UpdateBuyDto): Promise<BuyDto> {
    return this.buyService.updateBuy(jwt.user, +id, dto).then((b) => this.toDto(jwt.user, b));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getBuyRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<BuyHistoryDto[]> {
    return this.buyCryptoService.getBuyHistory(jwt.user, +id);
  }

  // --- DTO --- //
  private async toDtoList(userId: number, buys: Buy[]): Promise<BuyDto[]> {
    return Promise.all(buys.map((b) => this.toDto(userId, b)));
  }

  private async toDto(userId: number, buy: Buy): Promise<BuyDto> {
    const { minDeposit } = this.transactionHelper.getDefaultSpecs(
      'Fiat',
      undefined,
      buy.asset.blockchain,
      buy.asset.dexName,
    );

    const fee = await this.userService.getUserFee(
      userId,
      FiatPaymentMethod.BANK,
      CryptoPaymentMethod.CRYPTO,
      IbanBankName.MAERKI,
      undefined,
      await this.fiatService.getFiatByName('EUR'),
      buy.asset,
    );

    return {
      id: buy.id,
      active: buy.active,
      iban: buy.iban,
      volume: buy.volume,
      annualVolume: buy.annualVolume,
      bankUsage: buy.active ? buy.bankUsage : undefined,
      asset: AssetDtoMapper.toDto(buy.asset),
      fee: Util.round(fee.rate * 100, Config.defaultPercentageDecimal),
      minDeposits: [minDeposit],
      minFee: { amount: fee.network, asset: 'CHF' },
    };
  }
}
