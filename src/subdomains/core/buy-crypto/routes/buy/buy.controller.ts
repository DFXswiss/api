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
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpGuard } from 'src/shared/auth/ip.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { Util } from 'src/shared/utils/util';
import { UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankSelectorInput, BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionRequestType } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
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
import { InvoiceDto } from './dto/invoice.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@ApiTags('Buy')
@Controller('buy')
export class BuyController {
  private readonly logger = new DfxLogger(BuyController);

  constructor(
    private readonly buyService: BuyService,
    private readonly userService: UserService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly paymentInfoService: PaymentInfoService,
    private readonly bankService: BankService,
    private readonly transactionHelper: TransactionHelper,
    private readonly checkoutService: CheckoutService,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly fiatService: FiatService,
    private readonly swissQrService: SwissQRService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllBuy(@GetJwt() jwt: JwtPayload): Promise<BuyDto[]> {
    return this.buyService.getUserBuys(jwt.user).then((l) => this.toDtoList(jwt.user, l));
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: BuyDto })
  async getBuy(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<BuyDto> {
    return this.buyService.get(jwt.account, +id).then((l) => this.toDto(jwt.user, l));
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
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
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard)
  @ApiOkResponse({ type: BuyPaymentInfoDto })
  async createBuyWithPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: GetBuyPaymentInfoDto,
  ): Promise<BuyPaymentInfoDto> {
    const times = [Date.now()];

    dto = await this.paymentInfoService.buyCheck(dto, jwt);

    times.push(Date.now());

    const buy = await Util.retry(
      () => this.buyService.createBuy(jwt.user, jwt.address, dto, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    );

    times.push(Date.now());

    const infos = await this.toPaymentInfoDto(jwt.user, buy, dto);

    times.push(Date.now());

    const timeString = Util.createTimeString(times);
    if (timeString) this.logger.verbose(`Buy info${dto.exactPrice ? ' exact' : ''} request times: ${timeString}`);

    return infos;
  }

  @Put('/paymentInfos/:id/invoice')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard)
  @ApiOkResponse({ type: InvoiceDto })
  async generateInvoicePDF(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<InvoiceDto> {
    const request = await this.transactionRequestService.getOrThrow(+id, jwt.user);
    if (!request.user.userData.isDataComplete) throw new BadRequestException('User data is not complete');
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');
    if (request.isComplete) throw new ConflictException('Transaction request is already confirmed');

    const buy = await this.buyService.get(jwt.account, request.routeId);
    const currency = await this.fiatService.getFiat(request.sourceId);
    const bankInfo = await this.getBankInfo({
      amount: request.amount,
      currency: currency.name,
      paymentMethod: request.sourcePaymentMethod as FiatPaymentMethod,
      userData: request.user.userData,
    });

    if (currency.name !== 'CHF') throw new Error('PDF invoice is only available for CHF payments');

    return {
      invoicePdf: await this.swissQrService.createInvoice(
        request.amount,
        currency.name,
        buy.bankUsage,
        bankInfo,
        request,
      ),
    };
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async updateBuyRoute(@GetJwt() jwt: JwtPayload, @Param('id') id: string, @Body() dto: UpdateBuyDto): Promise<BuyDto> {
    return this.buyService.updateBuy(jwt.user, +id, dto).then((b) => this.toDto(jwt.user, b));
  }

  @Get(':id/history')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
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

  private async toPaymentInfoDto(userId: number, buy: Buy, dto: GetBuyPaymentInfoDto): Promise<BuyPaymentInfoDto> {
    const times = [Date.now()];

    const user = await this.userService.getUser(userId, { userData: { users: true }, wallet: true });

    times.push(Date.now());

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
      dto.currency,
      dto.asset,
      dto.paymentMethod,
      CryptoPaymentMethod.CRYPTO,
      !dto.exactPrice,
      user,
    );

    times.push(Date.now());

    const bankInfo = await this.getBankInfo({
      amount: amount,
      currency: dto.currency.name,
      paymentMethod: dto.paymentMethod,
      userData: user.userData,
    });

    times.push(Date.now());

    const buyDto: BuyPaymentInfoDto = {
      id: 0, // set during request creation
      timestamp,
      routeId: buy.id,
      fee: Util.round(feeSource.rate * 100, Config.defaultPercentageDecimal),
      minDeposit: { amount: minVolume, asset: dto.currency.name }, // TODO: remove
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
      asset: AssetDtoMapper.toDto(dto.asset),
      currency: FiatDtoMapper.toDto(dto.currency),
      maxVolume,
      maxVolumeTarget,
      isValid,
      error,
      // bank info
      ...bankInfo,
      sepaInstant: bankInfo.sepaInstant,
      remittanceInfo: buy.active ? buy.bankUsage : undefined,
      paymentRequest: isValid ? this.generateQRCode(buy, bankInfo, dto) : undefined,
      // card info
      paymentLink:
        isValid && buy.active && dto.paymentMethod === FiatPaymentMethod.CARD
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
        !(
          user.userData.status === UserDataStatus.ACTIVE ||
          (Boolean(user.userData.firstname) && Boolean(user.userData.surname))
        ),
    };

    times.push(Date.now());

    await this.transactionRequestService.create(TransactionRequestType.BUY, dto, buyDto, user.id);

    times.push(Date.now());

    const timeString = Util.createTimeString(times);
    if (timeString) this.logger.verbose(`Buy info to payment request times: ${timeString}`);

    return buyDto;
  }

  // --- HELPER-METHODS --- //
  private async getBankInfo(selector: BankSelectorInput): Promise<BankInfoDto> {
    const bank = await this.bankService.getBank(selector);

    if (!bank) throw new BadRequestException('No Bank for the given amount/currency');

    return { ...Config.bank.dfxBankInfo, bank: bank.name, iban: bank.iban, bic: bank.bic, sepaInstant: bank.sctInst };
  }

  private generateQRCode(buy: Buy, bankInfo: BankInfoDto, dto: GetBuyPaymentInfoDto): string {
    if (dto.currency.name === 'CHF') {
      return this.swissQrService.createQrCode(dto.amount, dto.currency.name, buy.bankUsage, bankInfo);
    } else {
      return this.generateGiroCode(buy, bankInfo, dto);
    }
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
