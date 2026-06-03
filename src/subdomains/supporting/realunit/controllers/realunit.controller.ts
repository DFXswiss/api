import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiExcludeEndpoint,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Config, Environment } from 'src/config/config';
import {
  BrokerbotBuyPriceDto,
  BrokerbotBuySharesDto,
  BrokerbotCurrency,
  BrokerbotCurrencyQueryDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSellPriceDto,
  BrokerbotSellSharesDto,
} from 'src/integration/blockchain/realunit/dto/realunit-broker.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpGuard } from 'src/shared/auth/ip.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PdfBrand } from 'src/shared/utils/pdf.util';
import { Util } from 'src/shared/utils/util';
import { PdfDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/pdf.dto';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PdfLanguage } from '../../balance/dto/input/get-balance-pdf.dto';
import { BalancePdfService } from '../../balance/services/balance-pdf.service';
import { SwissQRService } from '../../payment/services/swiss-qr.service';
import { PriceCurrency, PricingService } from '../../pricing/services/pricing.service';
import { RealUnitAdminQueryDto, RealUnitQuoteDto, RealUnitTransactionDto } from '../dto/realunit-admin.dto';
import {
  RealUnitConfirmAktionariatDto,
  RealUnitConfirmAktionariatQueryDto,
} from '../dto/realunit-confirm-aktionariat.dto';
import {
  RealUnitBalancePdfDto,
  RealUnitMultiReceiptPdfDto,
  RealUnitSingleReceiptPdfDto,
  ReceiptCurrency,
} from '../dto/realunit-pdf.dto';
import {
  RealUnitEmailRegistrationDto,
  RealUnitEmailRegistrationResponseDto,
  RealUnitRegisterWalletDto,
  RealUnitRegistrationDateDto,
  RealUnitRegistrationDto,
  RealUnitRegistrationInfoDto,
  RealUnitRegistrationResponseDto,
  RealUnitRegistrationStatus,
} from '../dto/realunit-registration.dto';
import {
  RealUnitOcpPayDto,
  RealUnitOcpPayResultDto,
  RealUnitOcpPayStatusDto,
  RealUnitOcpPaySubmitDto,
  RealUnitOcpPayUnsignedTransactionDto,
  RealUnitSwapDto,
  RealUnitSwapPaymentInfoDto,
  RealUnitSwapUnsignedTransactionDto,
} from '../dto/realunit-pay.dto';
import {
  RealUnitSellBroadcastDto,
  RealUnitSellConfirmDto,
  RealUnitSellDto,
  RealUnitSellPaymentInfoDto,
} from '../dto/realunit-sell.dto';
import {
  RealUnitTransferConfirmDto,
  RealUnitTransferDto,
  RealUnitTransferPaymentInfoDto,
} from '../dto/realunit-transfer.dto';
import {
  AccountHistoryDto,
  AccountHistoryQueryDto,
  AccountSummaryDto,
  HistoricalPriceDto,
  HistoricalPriceQueryDto,
  HoldersDto,
  HoldersQueryDto,
  RealUnitBuyConfirmDto,
  RealUnitBuyDto,
  RealUnitPaymentInfoDto,
  TimeFrame,
  TokenInfoDto,
} from '../dto/realunit.dto';
import { RealUnitService } from '../realunit.service';

@ApiTags('Realunit')
@Controller('realunit')
export class RealUnitController {
  constructor(
    private readonly realunitService: RealUnitService,
    private readonly balancePdfService: BalancePdfService,
    private readonly userService: UserService,
    private readonly swissQrService: SwissQRService,
    private readonly pricingService: PricingService,
  ) {}

  @Get('account/:address')
  @ApiOperation({
    summary: 'Get account information',
    description: 'Retrieves account information for a specific address on the Realunit protocol',
  })
  @ApiOkResponse({ type: AccountSummaryDto })
  @ApiParam({ name: 'address', type: String })
  async getAccountSummary(@Param('address') address: string): Promise<AccountSummaryDto> {
    return this.realunitService.getAccount(address);
  }

  @Get('account/:address/history')
  @ApiOperation({
    summary: 'Get account history',
    description: 'Retrieves a paginated transaction history for a specific address on the Realunit protocol',
  })
  @ApiOkResponse({ type: AccountHistoryDto })
  @ApiParam({
    name: 'address',
    description: 'The wallet address to query',
  })
  async getAccountHistory(
    @Param('address') address: string,
    @Query() { first, before, after }: AccountHistoryQueryDto,
  ): Promise<AccountHistoryDto> {
    return this.realunitService.getAccountHistory(address, first, before, after);
  }

  @Get('holders')
  @ApiOperation({
    summary: 'Get token holders',
    description: 'Retrieves a paginated list of token holders on the Realunit protocol',
  })
  @ApiOkResponse({ type: HoldersDto })
  async getHolders(@Query() { first, before, after }: HoldersQueryDto): Promise<HoldersDto> {
    return this.realunitService.getHolders(first, before, after);
  }

  @Get('price/history')
  @ApiOperation({
    summary: 'Get historical prices',
    description: 'Retrieves the historical prices of RealUnit token in multiple currencies (CHF, EUR, USD)',
  })
  @ApiOkResponse({ type: [HistoricalPriceDto] })
  async getHistoricalPrice(@Query() { timeFrame }: HistoricalPriceQueryDto): Promise<HistoricalPriceDto[]> {
    return this.realunitService.getHistoricalPrice(timeFrame ?? TimeFrame.WEEK);
  }

  @Get('price')
  @ApiOperation({
    summary: 'Get RealUnit price',
    description: 'Retrieves the current price of RealUnit on the Realunit protocol',
  })
  @ApiOkResponse({ type: HistoricalPriceDto })
  async getRealUnitPrice(): Promise<HistoricalPriceDto> {
    return this.realunitService.getRealUnitPrice();
  }
  @Get('tokenInfo')
  @ApiOperation({
    summary: 'Get token info',
    description: 'Retrieves the information of the RealUnit token',
  })
  @ApiOkResponse({ type: TokenInfoDto })
  async getTokenInfo(): Promise<TokenInfoDto> {
    return this.realunitService.getRealUnitInfo();
  }

  // --- PDF Endpoints ---

  @Post('balance/pdf')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get RealUnit portfolio statement PDF',
    description:
      'Generates a RealUnit portfolio statement ("Vermögensübersicht") for the connected wallet, in the same letter design as the transaction receipts. The queried wallet must belong to the caller.',
  })
  @ApiOkResponse({ type: PdfDto, description: 'Portfolio statement PDF (base64 encoded)' })
  @ApiBadRequestResponse({
    description:
      'The RealUnit holding could not be priced for the selected reference date, or the date is invalid (must be in the past).',
  })
  @ApiForbiddenResponse({ description: 'The queried wallet does not belong to the caller' })
  async getBalancePdf(@GetJwt() jwt: JwtPayload, @Body() dto: RealUnitBalancePdfDto): Promise<PdfDto> {
    // Fail-closed: a statement carries the holder's identity, so it may only be issued for the caller's
    // own wallet — never for an arbitrary address supplied in the body.
    if (!Util.equalsIgnoreCase(dto.address, jwt.address))
      throw new ForbiddenException('A statement can only be requested for your own wallet');

    const tokenBlockchain = [Environment.DEV, Environment.LOC].includes(Config.environment)
      ? Blockchain.SEPOLIA
      : Blockchain.ETHEREUM;

    // Value and print the statement on the same Swiss calendar day, so the tax-value year (UTC) and the
    // printed reference date (Europe/Zurich) can never diverge. A future/boundary reference date is rejected
    // fail-closed — a tax statement is only issued for a past year-end.
    const referenceDate = SwissQRService.toSwissReferenceDate(dto.date);
    if (referenceDate.getTime() > Date.now()) throw new BadRequestException('The reference date must be in the past');

    const user = await this.userService.getUser(jwt.user, { userData: true });

    // A RealUnit portfolio statement is a share-register document: it must list only the RealUnit
    // token, never other assets (e.g. a ZCHF dust balance) that happen to sit on the same address.
    const realuAsset = await this.realunitService.getRealuAsset();
    const { balances, totalValue } = await this.balancePdfService.getBalanceData(
      { ...dto, blockchain: tokenBlockchain, date: referenceDate },
      (asset) => asset.id === realuAsset.id,
    );

    const pdfData = await this.swissQrService.createBalanceStatement(
      balances,
      totalValue,
      user.userData,
      dto.currency,
      referenceDate,
      dto.language ?? PdfLanguage.EN,
      dto.address,
    );

    return { pdfData };
  }

  @Post('transactions/receipt/single')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Generate receipt from blockchain transaction',
    description: 'Generates a PDF receipt for any RealUnit transaction found in blockchain history',
  })
  @ApiOkResponse({ type: PdfDto, description: 'Receipt PDF (base64 encoded)' })
  @ApiBadRequestResponse({ description: 'Transaction not found or not a transfer' })
  async generateHistoryReceipt(@GetJwt() jwt: JwtPayload, @Body() dto: RealUnitSingleReceiptPdfDto): Promise<PdfDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    const currency = dto.currency ?? ReceiptCurrency.CHF;
    const historyEvent = await this.realunitService.getHistoryEventByTxHash(jwt.address, dto.txHash);
    const realuAsset = await this.realunitService.getRealuAsset();
    const price = await this.pricingService.getPriceAt(realuAsset, PriceCurrency[currency], historyEvent.timestamp);
    const isIncoming = Util.equalsIgnoreCase(historyEvent.transfer.to, jwt.address);

    const pdfData = await this.swissQrService.createTxFromBlockchainReceipt(
      historyEvent,
      user.userData,
      realuAsset,
      price.convert(1),
      currency,
      isIncoming,
      PdfBrand.REALUNIT,
      dto.language,
    );

    return { pdfData };
  }

  @Post('transactions/receipt/multi')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Generate multi-receipt from blockchain transactions',
    description: 'Generates a single PDF receipt for multiple RealUnit transactions found in blockchain history',
  })
  @ApiOkResponse({ type: PdfDto, description: 'Receipt PDF (base64 encoded)' })
  @ApiBadRequestResponse({ description: 'Transaction not found or not a transfer' })
  async generateHistoryMultiReceipt(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: RealUnitMultiReceiptPdfDto,
  ): Promise<PdfDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    const currency = dto.currency ?? ReceiptCurrency.CHF;
    const historyEvents = await this.realunitService.getHistoryEventsByTxHashes(jwt.address, dto.txHashes);
    const realuAsset = await this.realunitService.getRealuAsset();

    const receipts = await Promise.all(
      historyEvents.map(async (event) => {
        const price = await this.pricingService.getPriceAt(realuAsset, PriceCurrency[currency], event.timestamp);
        const isIncoming = Util.equalsIgnoreCase(event.transfer.to, jwt.address);
        return {
          historyEvent: event,
          fiatPrice: price.convert(1),
          isIncoming,
        };
      }),
    );

    const pdfData = await this.swissQrService.createTxFromBlockchainMultiReceipt(
      receipts,
      user.userData,
      realuAsset,
      currency,
      PdfBrand.REALUNIT,
      dto.language,
    );

    return { pdfData };
  }

  // --- Quote Endpoints ---
  // Backed by the off-chain Aktionariat REST API (`/directinvestment/getPrice`, 30 s cache).
  // The on-chain Brokerbot smart contract is read by the sell-flow routes that anchor a quote
  // against live chain state — `PUT /sell`, `PUT /sell/:id/unsigned-transactions`, and
  // `PUT /sell/:id/confirm` — see the CONTRIBUTING.md "RealUnit: /quote/* vs /brokerbot/*"
  // section for the full table. The legacy `/brokerbot/*` mirror endpoints below are deprecated.

  @Get('quote/info')
  @ApiOperation({
    summary: 'Get RealUnit quote info',
    description:
      'Returns the REALU spot price together with the on-chain Brokerbot contract addresses (token / base currency / brokerbot). The price values come from the Aktionariat REST API, not from an on-chain read.',
  })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotInfoDto })
  async getQuoteInfo(@Query() { currency }: BrokerbotCurrencyQueryDto): Promise<BrokerbotInfoDto> {
    return this.realunitService.getBrokerbotInfo(currency);
  }

  @Get('quote/price')
  @ApiOperation({
    summary: 'Get current REALU spot price',
    description:
      'Returns the current price per REALU share. Sourced from the Aktionariat REST API (30 s cache); not an on-chain read.',
  })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotPriceDto })
  async getQuotePrice(@Query() { currency }: BrokerbotCurrencyQueryDto): Promise<BrokerbotPriceDto> {
    return this.realunitService.getBrokerbotPrice(currency);
  }

  @Get('quote/buyPrice')
  @ApiOperation({
    summary: 'Get total fiat cost for a number of shares (buy quote)',
    description: 'Returns the total fiat amount needed to buy a specific number of REALU shares.',
  })
  @ApiQuery({ name: 'shares', type: Number, description: 'Number of shares to buy' })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotBuyPriceDto })
  async getQuoteBuyPrice(
    @Query('shares') shares: number,
    @Query() { currency }: BrokerbotCurrencyQueryDto,
  ): Promise<BrokerbotBuyPriceDto> {
    return this.realunitService.getBrokerbotBuyPrice(Number(shares), currency);
  }

  @Get('quote/buyShares')
  @ApiOperation({
    summary: 'Get shares purchasable for a fiat amount (buy quote)',
    description: 'Returns how many REALU shares can be purchased for a given fiat amount.',
  })
  @ApiQuery({ name: 'amount', type: String, description: 'Amount in specified currency (e.g., "1000.50")' })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotBuySharesDto })
  async getQuoteBuyShares(
    @Query('amount') amount: number,
    @Query() { currency }: BrokerbotCurrencyQueryDto,
  ): Promise<BrokerbotBuySharesDto> {
    return this.realunitService.getBrokerbotBuyShares(amount, currency);
  }

  @Get('quote/sellPrice')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get estimated sell payout for a number of shares (after fees)',
    description:
      'Returns the estimated fiat payout when selling a specific number of REALU shares, including user-specific fees.',
  })
  @ApiQuery({ name: 'shares', type: Number, description: 'Number of shares to sell' })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotSellPriceDto })
  async getQuoteSellPrice(
    @GetJwt() jwt: JwtPayload,
    @Query('shares') shares: number,
    @Query() { currency }: BrokerbotCurrencyQueryDto,
  ): Promise<BrokerbotSellPriceDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    return this.realunitService.getBrokerbotSellPrice(user, Number(shares), currency);
  }

  @Get('quote/sellShares')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get shares needed for a target sell payout (after fees)',
    description:
      'Returns how many REALU shares need to be sold to receive a target fiat amount after user-specific fees.',
  })
  @ApiQuery({ name: 'amount', type: Number, description: 'Target amount to receive after fees (e.g., 1000.50)' })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotSellSharesDto })
  async getQuoteSellShares(
    @GetJwt() jwt: JwtPayload,
    @Query('amount') amount: number,
    @Query() { currency }: BrokerbotCurrencyQueryDto,
  ): Promise<BrokerbotSellSharesDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    return this.realunitService.getBrokerbotSellShares(user, Number(amount), currency);
  }

  // --- Brokerbot Endpoints (deprecated — use the /quote/* mirrors above) ---

  @Get('brokerbot/info')
  @ApiOperation({
    summary: 'Get Brokerbot info',
    description: 'Deprecated mirror of `/quote/info`. See that endpoint for the canonical description.',
    deprecated: true,
  })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotInfoDto })
  async getBrokerbotInfo(@Query() { currency }: BrokerbotCurrencyQueryDto): Promise<BrokerbotInfoDto> {
    return this.realunitService.getBrokerbotInfo(currency);
  }

  @Get('brokerbot/price')
  @ApiOperation({
    summary: 'Get current Brokerbot price',
    description: 'Deprecated mirror of `/quote/price`. See that endpoint for the canonical description.',
    deprecated: true,
  })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotPriceDto })
  async getBrokerbotPrice(@Query() { currency }: BrokerbotCurrencyQueryDto): Promise<BrokerbotPriceDto> {
    return this.realunitService.getBrokerbotPrice(currency);
  }

  @Get('brokerbot/buyPrice')
  @ApiOperation({
    summary: 'Get buy price for shares',
    description: 'Deprecated mirror of `/quote/buyPrice`. See that endpoint for the canonical description.',
    deprecated: true,
  })
  @ApiQuery({ name: 'shares', type: Number, description: 'Number of shares to buy' })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotBuyPriceDto })
  async getBrokerbotBuyPrice(
    @Query('shares') shares: number,
    @Query() { currency }: BrokerbotCurrencyQueryDto,
  ): Promise<BrokerbotBuyPriceDto> {
    return this.realunitService.getBrokerbotBuyPrice(Number(shares), currency);
  }

  @Get('brokerbot/buyShares')
  @ApiOperation({
    summary: 'Get shares for amount',
    description: 'Deprecated mirror of `/quote/buyShares`. See that endpoint for the canonical description.',
    deprecated: true,
  })
  @ApiQuery({ name: 'amount', type: String, description: 'Amount in specified currency (e.g., "1000.50")' })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotBuySharesDto })
  async getBrokerbotBuyShares(
    @Query('amount') amount: number,
    @Query() { currency }: BrokerbotCurrencyQueryDto,
  ): Promise<BrokerbotBuySharesDto> {
    return this.realunitService.getBrokerbotBuyShares(amount, currency);
  }

  @Get('brokerbot/sellPrice')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get sell price for shares including fees',
    description: 'Deprecated mirror of `/quote/sellPrice`. See that endpoint for the canonical description.',
    deprecated: true,
  })
  @ApiQuery({ name: 'shares', type: Number, description: 'Number of shares to sell' })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotSellPriceDto })
  async getBrokerbotSellPrice(
    @GetJwt() jwt: JwtPayload,
    @Query('shares') shares: number,
    @Query() { currency }: BrokerbotCurrencyQueryDto,
  ): Promise<BrokerbotSellPriceDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    return this.realunitService.getBrokerbotSellPrice(user, Number(shares), currency);
  }

  @Get('brokerbot/sellShares')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get shares needed to receive target amount including fees',
    description: 'Deprecated mirror of `/quote/sellShares`. See that endpoint for the canonical description.',
    deprecated: true,
  })
  @ApiQuery({ name: 'amount', type: Number, description: 'Target amount to receive after fees (e.g., 1000.50)' })
  @ApiQuery({
    name: 'currency',
    enum: BrokerbotCurrency,
    required: false,
    description: 'Currency for prices (CHF or EUR)',
  })
  @ApiOkResponse({ type: BrokerbotSellSharesDto })
  async getBrokerbotSellShares(
    @GetJwt() jwt: JwtPayload,
    @Query('amount') amount: number,
    @Query() { currency }: BrokerbotCurrencyQueryDto,
  ): Promise<BrokerbotSellSharesDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    return this.realunitService.getBrokerbotSellShares(user, Number(amount), currency);
  }

  // --- Buy Payment Info Endpoint ---

  @Put('buy')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get payment info for RealUnit buy',
    description:
      'Returns personal IBAN and payment details for purchasing REALU tokens. Requires KYC Level 30 and RealUnit registration. Pre-tap prerequisite state travels in the response: `isValid: false` with `error: PrimaryEmailRequired` signals a missing primary email — the client must register one via `POST /v1/realunit/register/email` before calling `PUT /v1/realunit/buy/:id/confirm`.',
  })
  @ApiOkResponse({ type: RealUnitPaymentInfoDto })
  @ApiBadRequestResponse({ description: 'KYC Level 30 required, registration missing, or address not on allowlist' })
  async getPaymentInfo(@GetJwt() jwt: JwtPayload, @Body() dto: RealUnitBuyDto): Promise<RealUnitPaymentInfoDto> {
    const user = await this.userService.getUser(jwt.user, { userData: { country: true } });
    return this.realunitService.getPaymentInfo(user, dto);
  }

  @Put('buy/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), IpGuard)
  @ApiOperation({
    summary: 'Confirm RealUnit buy order',
    description:
      'Requests the payment instructions from Aktionariat and confirms the buy order. The pre-tap prerequisite state (e.g. missing primary email) is exposed via `PUT /v1/realunit/buy` in `isValid`/`error`; this endpoint only re-checks it as a fail-closed backstop.',
  })
  @ApiOkResponse({ type: RealUnitBuyConfirmDto, description: 'Payment confirmed' })
  @ApiBadRequestResponse({
    description:
      'Fail-closed backstop for prerequisite failures raced between payment-info and confirm — e.g. a missing primary email is returned as `{ code: PrimaryEmailRequired }`. The pre-tap state is exposed via `PUT /v1/realunit/buy` (`isValid`/`error`).',
  })
  async confirmBuy(@GetJwt() jwt: JwtPayload, @Param('id', ParseIntPipe) id: number): Promise<RealUnitBuyConfirmDto> {
    return this.realunitService.confirmBuy(jwt.user, id);
  }

  // --- Sell Payment Info Endpoints ---

  @Put('sell')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get payment info for RealUnit sell',
    description:
      'Returns EIP-7702 delegation data for gasless REALU transfer and fallback deposit info. Requires KYC Level 30 and RealUnit registration.',
  })
  @ApiOkResponse({ type: RealUnitSellPaymentInfoDto })
  @ApiBadRequestResponse({ description: 'KYC Level 30 required or registration missing' })
  async getSellPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: RealUnitSellDto,
  ): Promise<RealUnitSellPaymentInfoDto> {
    const user = await this.userService.getUser(jwt.user, { userData: { country: true } });
    return this.realunitService.getSellPaymentInfo(user, dto);
  }

  @Put('sell/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Confirm RealUnit sell transaction',
    description: 'Confirms the sell transaction with EIP-7702 signatures or manual transaction hash.',
  })
  @ApiParam({ name: 'id', description: 'Transaction request ID' })
  @ApiOkResponse({ description: 'Transaction confirmed', schema: { properties: { txHash: { type: 'string' } } } })
  @ApiBadRequestResponse({ description: 'Invalid transaction request or signatures' })
  async confirmSell(
    @GetJwt() jwt: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RealUnitSellConfirmDto,
  ): Promise<{ txHash: string }> {
    return this.realunitService.confirmSell(jwt.user, id, dto);
  }

  @Put('sell/:id/unsigned-transactions')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get unsigned EVM transactions for both sell steps with consecutive nonces',
    description:
      'Returns unsigned transactions for brokerbotSell (nonce N) and zchfDeposit (nonce N+1) in one call, ensuring no nonce collision when both are broadcast.',
  })
  @ApiParam({ name: 'id', description: 'Transaction request ID' })
  @ApiOkResponse({ schema: { properties: { swap: { type: 'string' }, deposit: { type: 'string' } } } })
  @ApiBadRequestResponse({ description: 'Invalid request or insufficient ETH for gas' })
  async getSellUnsignedTransactions(
    @GetJwt() jwt: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ swap: string; deposit: string }> {
    return this.realunitService.createSellUnsignedTransactions(jwt.user, id);
  }

  @Put('sell/:id/broadcast')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Broadcast a signed EVM transaction for a sell step',
    description: 'Broadcasts a signed EIP-1559 transaction for the specified sell step (brokerbotSell or zchfDeposit).',
  })
  @ApiParam({ name: 'id', description: 'Transaction request ID' })
  @ApiOkResponse({ description: 'Transaction broadcast', schema: { properties: { txHash: { type: 'string' } } } })
  @ApiBadRequestResponse({ description: 'Invalid signed transaction or broadcast failure' })
  async broadcastSellTransaction(
    @GetJwt() jwt: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RealUnitSellBroadcastDto,
  ): Promise<{ txHash: string }> {
    return this.realunitService.broadcastSellTransaction(jwt.user, id, dto);
  }

  // --- W2W Transfer Endpoints --- //

  @Put('transfer')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Prepare a gasless RealUnit wallet-to-wallet transfer',
    description:
      'Persists the transfer intent and returns the EIP-7702 delegation data the app must sign for a gasless REALU transfer. DFX pays gas from a dedicated W2W gas wallet. Requires KYC Level 30 and RealUnit registration.',
  })
  @ApiOkResponse({ type: RealUnitTransferPaymentInfoDto })
  @ApiBadRequestResponse({
    description: 'KYC Level 30 required, registration missing, or invalid recipient/amount',
  })
  async prepareTransfer(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: RealUnitTransferDto,
  ): Promise<RealUnitTransferPaymentInfoDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    return this.realunitService.prepareTransfer(user, dto);
  }

  @Put('transfer/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Confirm a RealUnit wallet-to-wallet transfer',
    description:
      'Relays the user-signed EIP-7702 delegation for the stored transfer request. DFX pays gas from the dedicated W2W gas wallet. Returns the transaction hash.',
  })
  @ApiParam({ name: 'id', description: 'Transfer request ID' })
  @ApiOkResponse({ description: 'Transfer confirmed', schema: { properties: { txHash: { type: 'string' } } } })
  @ApiBadRequestResponse({ description: 'Invalid delegation or authorization' })
  @ApiNotFoundResponse({ description: 'Transfer request not found' })
  async confirmTransfer(
    @GetJwt() jwt: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RealUnitTransferConfirmDto,
  ): Promise<{ txHash: string }> {
    return this.realunitService.confirmTransfer(jwt.user, id, dto);
  }

  // --- OCP Pay-Flow Endpoints ---
  // Phase 2 pay flow: swap REALU -> ZCHF keeping the ZCHF in the user wallet, then pay that ZCHF to an
  // Open CryptoPay recipient via the public lnurlp payment-link flow. The backend orchestrates the steps
  // (workflow endpoints) since the app cannot build EVM calldata or settle the OCP quote locally.

  @Put('swap')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get swap quote for an IBAN-free REALU -> ZCHF swap (proceeds stay in the user wallet)',
    description:
      'Creates a SWAP-type transaction request for a REALU -> ZCHF swap WITHOUT a fiat IBAN, Sell route or payout, so the ZCHF proceeds stay in the connected wallet (to then pay at an OCP/SPAR POS). Same registration + KYC Level 30 gating as sell, and KYC trading limits are still enforced (a quote over the limit returns a typed error / KYC-level requirement). Step 0 of the OCP pay flow: feed the returned `id` into `PUT /swap/:id/unsigned-transaction`. Requires KYC Level 30 and RealUnit registration.',
  })
  @ApiOkResponse({ type: RealUnitSwapPaymentInfoDto })
  @ApiBadRequestResponse({ description: 'KYC Level 30 required, registration missing, or trading limit exceeded' })
  async getSwapPaymentInfo(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: RealUnitSwapDto,
  ): Promise<RealUnitSwapPaymentInfoDto> {
    const user = await this.userService.getUser(jwt.user, { userData: { kycSteps: true, country: true } });
    return this.realunitService.getSwapPaymentInfo(user, dto);
  }

  @Put('swap/:id/unsigned-transaction')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get unsigned REALU -> ZCHF swap transaction (proceeds stay in the user wallet)',
    description:
      'Builds the REALU transferAndCall swap transaction WITHOUT the deposit sweep, so the ZCHF proceeds land in the connected wallet. Step 1 of the OCP pay flow (obtain the request `id` from `PUT /swap` first); broadcast the signed transaction via `PUT /swap/:id/broadcast`.',
  })
  @ApiParam({ name: 'id', description: 'Transaction request ID' })
  @ApiOkResponse({ type: RealUnitSwapUnsignedTransactionDto })
  @ApiBadRequestResponse({ description: 'Invalid request or insufficient ETH for gas' })
  async getSwapUnsignedTransaction(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
  ): Promise<RealUnitSwapUnsignedTransactionDto> {
    return this.realunitService.createSwapUnsignedTransaction(jwt.user, +id);
  }

  @Put('swap/:id/broadcast')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Broadcast a signed REALU -> ZCHF swap transaction',
    description:
      'Broadcasts the user-signed EIP-1559 swap transaction (from `PUT /swap/:id/unsigned-transaction`) to the network. Step 1b of the OCP pay flow; afterwards request the OCP pay transaction via `PUT /pay/unsigned-transaction`.',
  })
  @ApiParam({ name: 'id', description: 'Transaction request ID' })
  @ApiOkResponse({ description: 'Transaction broadcast', schema: { properties: { txHash: { type: 'string' } } } })
  @ApiBadRequestResponse({ description: 'Invalid signed transaction or broadcast failure' })
  async broadcastSwapTransaction(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RealUnitSellBroadcastDto,
  ): Promise<{ txHash: string }> {
    return this.realunitService.broadcastSwapTransaction(jwt.user, +id, dto);
  }

  @Put('pay/unsigned-transaction')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get unsigned ZCHF transfer transaction for an Open CryptoPay payment',
    description:
      'Resolves recipient and exact amount from the OCP payment-link quote (same source the lnurlp callback uses) and builds the unsigned ZCHF ERC-20 transfer transaction to the DFX deposit address. Step 2a of the OCP pay flow; submit the signed transaction via `PUT /pay/submit`. Broadcast the swap transaction (`PUT /swap/:id/broadcast`) before requesting this pay transaction — the pay-tx nonce is derived from the pending block so a still-pending swap tx is counted and the two transactions do not collide on the same nonce.',
  })
  @ApiOkResponse({ type: RealUnitOcpPayUnsignedTransactionDto })
  @ApiBadRequestResponse({ description: 'Invalid payment-link/quote reference or insufficient ETH for gas' })
  @ApiNotFoundResponse({ description: 'Unknown or expired payment-link/quote id' })
  async getOcpPayUnsignedTransaction(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: RealUnitOcpPayDto,
  ): Promise<RealUnitOcpPayUnsignedTransactionDto> {
    return this.realunitService.createOcpPayUnsignedTransaction(jwt.address, dto.paymentLinkId, dto.quoteId);
  }

  @Put('pay/submit')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Submit a signed ZCHF transfer to settle an Open CryptoPay payment',
    description:
      'Reconstructs the signed transaction and submits it into the existing lnurlp settlement path, where DFX validates recipient, amount, and min-fee, broadcasts it, and settles the OCP quote. Step 2b of the OCP pay flow.',
  })
  @ApiOkResponse({ type: RealUnitOcpPayResultDto })
  @ApiBadRequestResponse({ description: 'Invalid signed transaction or settlement failure' })
  @ApiNotFoundResponse({ description: 'Unknown or expired payment-link/quote id' })
  async submitOcpPay(@Body() dto: RealUnitOcpPaySubmitDto): Promise<RealUnitOcpPayResultDto> {
    return this.realunitService.submitOcpPay(dto);
  }

  @Get('pay/:id/status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get the status of an Open CryptoPay payment',
    description: 'Returns the OCP payment status by reusing the lnurlp wait path. Step 3 of the OCP pay flow.',
  })
  @ApiParam({ name: 'id', description: 'Payment-link or payment-link-payment unique id of the OCP payment' })
  @ApiOkResponse({ type: RealUnitOcpPayStatusDto })
  @ApiNotFoundResponse({ description: 'No pending payment found for the given id' })
  @ApiBadRequestResponse({ description: 'Invalid payment-link/quote reference' })
  async getOcpPayStatus(@Param('id') id: string): Promise<RealUnitOcpPayStatusDto> {
    return this.realunitService.getOcpPayStatus(id);
  }

  // --- Registration Info Endpoint ---

  @Get('registration')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get RealUnit registration info for the connected wallet',
    description:
      'Returns the action the client should take to RealUnit-register the connected wallet (`state`), the registration data to pre-fill or display (`userData`), and a legacy `isRegistered` flag. Drives the registration UX: client routes on `state` (AlreadyRegistered / AddWallet / NewRegistration) without inferring it locally.',
  })
  @ApiOkResponse({ type: RealUnitRegistrationInfoDto })
  async getRegistrationInfo(@GetJwt() jwt: JwtPayload): Promise<RealUnitRegistrationInfoDto> {
    const user = await this.userService.getUser(jwt.user, {
      userData: { country: true, nationality: true, organizationCountry: true, language: true },
    });
    return this.realunitService.getRegistrationInfo(user.userData, jwt.address);
  }

  @Get('wallet/status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get wallet status and user data',
    description:
      'Deprecated mirror of `GET /v1/realunit/registration`. See that endpoint for the canonical description.',
    deprecated: true,
  })
  @ApiOkResponse({ type: RealUnitRegistrationInfoDto })
  async getWalletStatus(@GetJwt() jwt: JwtPayload): Promise<RealUnitRegistrationInfoDto> {
    const user = await this.userService.getUser(jwt.user, {
      userData: { country: true, nationality: true, organizationCountry: true, language: true },
    });
    return this.realunitService.getRegistrationInfo(user.userData, jwt.address);
  }

  // --- Registration Endpoints ---

  @Get('register/date')
  @ApiBearerAuth()
  // ACCOUNT (not USER) to match the endpoints this date feeds — register/complete
  // and register/wallet are ACCOUNT-guarded, so any token that can register must
  // also be able to fetch the date to sign. ACCOUNT admits USER via the role
  // hierarchy, so this only widens access, never narrows it.
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOperation({
    summary: 'Get the registration date to sign',
    description:
      "Returns the server's current registration date (UTC). The client must sign this exact value into the " +
      'EIP-712 registration envelope submitted to POST /register/complete and POST /register/wallet, rather than ' +
      "deriving the date from its own clock — a device in a timezone ahead of UTC would otherwise sign tomorrow's " +
      'date and be rejected. Fetch this immediately before signing.',
  })
  @ApiOkResponse({ type: RealUnitRegistrationDateDto })
  getRegistrationDate(): RealUnitRegistrationDateDto {
    return this.realunitService.getRegistrationDate();
  }

  @Get('register/status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Check if wallet is registered for RealUnit',
    description: 'Returns true if the connected wallet is registered for RealUnit, false otherwise',
  })
  @ApiOkResponse({ type: Boolean })
  async isRegistered(@GetJwt() jwt: JwtPayload): Promise<boolean> {
    const user = await this.userService.getUser(jwt.user, { userData: true });
    return this.realunitService.hasRegistrationForWallet(user.userData, jwt.address);
  }

  @Post('register/email')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOperation({
    summary: 'Step 1: Register email for RealUnit',
    description:
      'First step of RealUnit registration. Checks if email exists in DFX system. If exists and merge is possible, sends merge confirmation email. Otherwise registers email and sets KYC Level 10.',
  })
  @ApiOkResponse({ type: RealUnitEmailRegistrationResponseDto })
  @ApiBadRequestResponse({ description: 'Email does not match verified email' })
  @ApiConflictResponse({ description: 'Account already exists and merge not possible' })
  async registerEmail(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: RealUnitEmailRegistrationDto,
  ): Promise<RealUnitEmailRegistrationResponseDto> {
    const status = await this.realunitService.registerEmail(jwt.account, dto);
    return { status };
  }

  @Post('register/complete')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOperation({
    summary: 'Step 2: Complete RealUnit registration',
    description:
      'Second step of RealUnit registration. Requires email registration to be completed. Validates personal data against DFX system and forwards to Aktionariat.',
  })
  @ApiOkResponse({ type: RealUnitRegistrationResponseDto })
  @ApiAcceptedResponse({
    type: RealUnitRegistrationResponseDto,
    description: 'Registration accepted or forwarding to Aktionariat failed',
  })
  @ApiBadRequestResponse({
    description: 'Invalid signature, wallet mismatch, email registration not completed, or data mismatch',
  })
  async completeRegistration(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: RealUnitRegistrationDto,
    @Res() res: Response,
  ): Promise<void> {
    const status = await this.realunitService.completeRegistration(jwt.account, dto);
    const response: RealUnitRegistrationResponseDto = {
      status: status,
    };
    const statusCode =
      status === RealUnitRegistrationStatus.COMPLETED || status === RealUnitRegistrationStatus.ALREADY_REGISTERED
        ? HttpStatus.CREATED
        : HttpStatus.ACCEPTED;
    res.status(statusCode).json(response);
  }

  @Post('register/wallet')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOperation({
    summary: 'Complete RealUnit registration for given wallet address that is already owned by a user',
    description: 'Completes a registration using existing data from the wallet status endpoint with a new signature.',
  })
  @ApiOkResponse({ type: RealUnitRegistrationResponseDto })
  @ApiAcceptedResponse({
    type: RealUnitRegistrationResponseDto,
    description: 'Registration accepted or forwarding to Aktionariat failed',
  })
  @ApiBadRequestResponse({ description: 'No pending registration, invalid signature, or wallet mismatch' })
  async completeRegistrationForWalletAddress(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: RealUnitRegisterWalletDto,
    @Res() res: Response,
  ): Promise<void> {
    const status = await this.realunitService.completeRegistrationForWalletAddress(jwt.account, dto);
    const response: RealUnitRegistrationResponseDto = { status };
    const statusCode =
      status === RealUnitRegistrationStatus.COMPLETED || status === RealUnitRegistrationStatus.ALREADY_REGISTERED
        ? HttpStatus.CREATED
        : HttpStatus.ACCEPTED;
    res.status(statusCode).json(response);
  }

  // --- Aktionariat Confirmation Endpoint (public) ---

  @Get('confirm-aktionariat')
  // Public and unauthenticated: each request runs a DB lookup on an attacker-controlled email and,
  // in prod, an outbound call to the third-party Aktionariat API — an amplification/DoS vector.
  // Rate-limited with the same values as the public `POST /auth/mail` endpoint.
  @UseGuards(RateLimitGuard)
  @Throttle(10, 60)
  @ApiOperation({
    summary: 'Confirm an Aktionariat email connection',
    description:
      'Public endpoint called from realunit.app/confirm-aktionariat when the user opens the email link. ' +
      'Server-side confirms the connection at Aktionariat using the provided code (which acts as the auth ' +
      'token) and documents the outcome per RealUnit-registered wallet. Returns the mapped state: ' +
      '`confirmed` (Aktionariat accepted), `confirmed_no_registration` (Aktionariat accepted the email, but ' +
      'no RealUnit registration matched it — a permanent outcome, not a retry candidate), `invalid` (link ' +
      'invalid/expired), or `unavailable` (Aktionariat unreachable — retry later).',
  })
  @ApiOkResponse({ type: RealUnitConfirmAktionariatDto })
  async confirmAktionariat(
    @Query() query: RealUnitConfirmAktionariatQueryDto,
    @Req() req: Request,
  ): Promise<RealUnitConfirmAktionariatDto> {
    // Capture the COMPLETE raw incoming request (every query param + the full URL) alongside the typed
    // email/code/user. The global ValidationPipe (whitelist: true) strips any extra param from the DTO, so the
    // raw query is the only place a mail-link param the DTO does not model (e.g. a wallet address / connection
    // id) survives — it is forwarded to the service purely to be audited in the DB `log` PII store. Headers are
    // intentionally not captured (they may carry auth/cookies). This adds no matching/validation behaviour.
    return this.realunitService.confirmAktionariat(query, { url: req.originalUrl, query: req.query });
  }

  // --- Admin Endpoints ---

  @Get('admin/quotes')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get RealUnit quotes' })
  @ApiOkResponse({ type: [RealUnitQuoteDto], description: 'List of open RealUnit requests (quotes)' })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getAdminQuotes(@Query() { limit, offset }: RealUnitAdminQueryDto): Promise<RealUnitQuoteDto[]> {
    return this.realunitService.getAdminQuotes(limit, offset);
  }

  @Get('admin/transactions')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get RealUnit transactions' })
  @ApiOkResponse({ type: [RealUnitTransactionDto], description: 'List of completed RealUnit transactions' })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getAdminTransactions(@Query() { limit, offset }: RealUnitAdminQueryDto): Promise<RealUnitTransactionDto[]> {
    return this.realunitService.getAdminTransactions(limit, offset);
  }

  @Put('admin/quotes/:id/confirm-payment')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Confirm payment received for a open RealUnit request (quote)' })
  @ApiParam({ name: 'id', description: 'Transaction request ID' })
  @ApiOkResponse({ description: 'Payment confirmed and shares allocated' })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async confirmPaymentReceived(@Param('id') id: string): Promise<void> {
    await this.realunitService.confirmPaymentReceived(+id);
  }

  @Put('admin/registration/:id/forward')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @ApiParam({ name: 'id', description: 'RealUnit registration ID' })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async forwardRegistration(@Param('id') id: string): Promise<void> {
    await this.realunitService.forwardRegistrationToAktionariat(+id);
  }
}
