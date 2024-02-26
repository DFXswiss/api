import { BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Config } from 'src/config/config';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpGuard } from 'src/shared/auth/ip.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { Util } from 'src/shared/utils/util';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionRequestType } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { BuyCryptoService } from '../../process/services/buy-crypto.service';
import { Buy } from './buy.entity';
import { BuyService } from './buy.service';
import { BuyHistoryDto } from './dto/buy-history.dto';
import { BankInfoDto, BuyPaymentInfoDto } from './dto/buy-payment-info.dto';
import { BuyQuoteDto } from './dto/buy-quote.dto';
import { BuyDto } from './dto/buy.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { GetBuyPaymentInfoDto } from './dto/get-buy-payment-info.dto';
import { GetBuyQuoteDto } from './dto/get-buy-quote.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@ApiTags('Buy')
@Controller('buy')
export class BuyController {
  constructor(
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly paymentInfoService: PaymentInfoService,
    private readonly bankService: BankService,
    private readonly transactionHelper: TransactionHelper,
    private readonly checkoutService: CheckoutService,
    private readonly transactionRequestService: TransactionRequestService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuy(@GetJwt() jwt: JwtPayload): Promise<BuyDto[]> {
    return this.buyService.getUserBuys(jwt.id).then((l) => this.toDtoList(jwt.id, l));
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: BuyDto })
  async getBuy(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<BuyDto> {
    return this.buyService.get(jwt.id, +id).then((l) => this.toDto(jwt.id, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async createBuy(@GetJwt() jwt: JwtPayload, @Body() dto: CreateBuyDto): Promise<BuyDto> {
    dto = await this.paymentInfoService.buyCheck(dto, jwt);
    return this.buyService.createBuy(jwt.id, jwt.address, dto).then((b) => this.toDto(jwt.id, b));
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
      discountCode,
    } = await this.paymentInfoService.buyCheck(dto);

    const {
      rate,
      exchangeRate,
      feeAmount,
      estimatedAmount,
      sourceAmount: amount,
      minVolume,
      minVolumeTarget,
      maxVolume,
      maxVolumeTarget,
      isValid,
      error,
    } = await this.transactionHelper.getTxDetails(
      sourceAmount,
      targetAmount,
      currency,
      asset,
      paymentMethod,
      CryptoPaymentMethod.CRYPTO,
      true,
      undefined,
      discountCode ? [discountCode] : [],
    );

    return {
      feeAmount,
      rate,
      exchangeRate,
      estimatedAmount,
      amount,
      minVolume,
      maxVolume,
      minVolumeTarget,
      maxVolumeTarget,
      isValid,
      error,
    };
  }

  @Put('/paymentInfos')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard)
  @ApiOkResponse({ type: BuyPaymentInfoDto })
  async createBuyWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetBuyPaymentInfoDto,
  ): Promise<BuyPaymentInfoDto> {
    dto = await this.paymentInfoService.buyCheck(dto, jwt);

    return Util.retry(
      () => this.buyService.createBuy(jwt.id, jwt.address, dto, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    ).then((buy) => this.toPaymentInfoDto(jwt.id, buy, dto));
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async updateBuyRoute(@GetJwt() jwt: JwtPayload, @Param('id') id: string, @Body() dto: UpdateBuyDto): Promise<BuyDto> {
    return this.buyService.updateBuy(jwt.id, +id, dto).then((b) => this.toDto(jwt.id, b));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getBuyRouteHistory(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<BuyHistoryDto[]> {
    return this.buyCryptoService.getBuyHistory(jwt.id, +id);
  }

  // --- DTO --- //
  private async toDtoList(userId: number, buys: Buy[]): Promise<BuyDto[]> {
    return Promise.all(buys.map((b) => this.toDto(userId, b)));
  }

  private async toDto(userId: number, buy: Buy): Promise<BuyDto> {
    const { minFee, minDeposit } = this.transactionHelper.getDefaultSpecs(
      'Fiat',
      undefined,
      buy.asset.blockchain,
      buy.asset.dexName,
    );

    const fee = await this.userService.getUserFee(
      userId,
      FiatPaymentMethod.BANK,
      CryptoPaymentMethod.CRYPTO,
      undefined,
      buy.asset,
      minFee.amount,
    );

    return {
      id: buy.id,
      active: buy.active,
      iban: buy.iban,
      volume: buy.volume,
      annualVolume: buy.annualVolume,
      bankUsage: buy.bankUsage,
      asset: AssetDtoMapper.toDto(buy.asset),
      fee: Util.round(fee.rate * 100, Config.defaultPercentageDecimal),
      minDeposits: [minDeposit],
      minFee: { amount: fee.blockchain, asset: 'CHF' },
    };
  }

  private async toPaymentInfoDto(userId: number, buy: Buy, dto: GetBuyPaymentInfoDto): Promise<BuyPaymentInfoDto> {
    const user = await this.userService.getUser(userId, { userData: true, wallet: true });

    const {
      minVolume,
      minFee,
      minVolumeTarget,
      minFeeTarget,
      maxVolume,
      maxVolumeTarget,
      fee,
      exchangeRate,
      rate,
      estimatedAmount,
      sourceAmount: amount,
      isValid,
      error,
      exactPrice,
    } = await this.transactionHelper.getTxDetails(
      dto.amount,
      dto.targetAmount,
      dto.currency,
      dto.asset,
      dto.paymentMethod,
      CryptoPaymentMethod.CRYPTO,
      !dto.exactPrice,
      user,
    );
    const bankInfo = await this.getBankInfo(buy, { ...dto, amount });

    const buyDto: BuyPaymentInfoDto = {
      routeId: buy.id,
      fee: Util.round(fee.rate * 100, Config.defaultPercentageDecimal),
      minDeposit: { amount: minVolume, asset: dto.currency.name }, // TODO: remove
      minVolume,
      minFee,
      minVolumeTarget,
      minFeeTarget,
      exchangeRate,
      rate,
      exactPrice,
      estimatedAmount,
      amount,
      asset: AssetDtoMapper.toDto(dto.asset),
      currency: FiatDtoMapper.toDto(dto.currency),
      maxVolume,
      maxVolumeTarget,
      isValid,
      error,
      // bank info
      ...bankInfo,
      sepaInstant: bankInfo.sepaInstant && buy.bankAccount?.sctInst,
      remittanceInfo: buy.bankUsage,
      paymentRequest: isValid ? this.generateGiroCode(buy, bankInfo, dto) : undefined,
      // card info
      paymentLink:
        isValid && dto.paymentMethod === FiatPaymentMethod.CARD
          ? await this.checkoutService.createPaymentLink(
              buy.bankUsage,
              amount,
              dto.currency,
              dto.asset,
              user.userData.language,
            )
          : undefined,
      // TODO: temporary CC solution
      nameRequired:
        dto.paymentMethod === FiatPaymentMethod.CARD &&
        !(user.status === UserStatus.ACTIVE || (Boolean(user.userData.firstname) && Boolean(user.userData.surname))),
    };

    void this.transactionRequestService.createTransactionRequest(TransactionRequestType.Buy, dto, buyDto);

    return buyDto;
  }

  // --- HELPER-METHODS --- //
  private async getBankInfo(buy: Buy, dto: GetBuyPaymentInfoDto): Promise<BankInfoDto> {
    const bank = await this.bankService.getBank({
      amount: dto.amount,
      currency: dto.currency.name,
      bankAccount: buy.bankAccount,
      paymentMethod: dto.paymentMethod,
    });

    if (!bank) throw new BadRequestException('No Bank for the given amount/currency');

    return { ...Config.bank.dfxBankInfo, iban: bank.iban, bic: bank.bic, sepaInstant: bank.sctInst };
  }

  private generateGiroCode(buy: Buy, bankInfo: BankInfoDto, dto: GetBuyPaymentInfoDto): string {
    return `
${Config.giroCode.service}
${Config.giroCode.version}
${Config.giroCode.encoding}
${Config.giroCode.transfer}
${bankInfo.bic}
${bankInfo.name}, ${bankInfo.street} ${bankInfo.number}, ${bankInfo.zip} ${bankInfo.city}, ${bankInfo.country}
${bankInfo.iban}
${dto.currency.name}${dto.amount}
${Config.giroCode.char}
${Config.giroCode.ref}
${buy.bankUsage}
`.trim();
  }
}
