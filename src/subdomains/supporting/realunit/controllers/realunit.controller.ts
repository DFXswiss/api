import { Body, Controller, Get, HttpStatus, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
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
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PdfBrand } from 'src/shared/utils/pdf.util';
import { Util } from 'src/shared/utils/util';
import { PdfDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/pdf.dto';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BalancePdfService } from '../../balance/services/balance-pdf.service';
import { SwissQRService } from '../../payment/services/swiss-qr.service';
import { PriceCurrency, PricingService } from '../../pricing/services/pricing.service';
import { RealUnitAdminQueryDto, RealUnitQuoteDto, RealUnitTransactionDto } from '../dto/realunit-admin.dto';
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
  RealUnitRegistrationDto,
  RealUnitRegistrationInfoDto,
  RealUnitRegistrationResponseDto,
  RealUnitRegistrationStatus,
} from '../dto/realunit-registration.dto';
import {
  RealUnitSellBroadcastDto,
  RealUnitSellConfirmDto,
  RealUnitSellDto,
  RealUnitSellPaymentInfoDto,
} from '../dto/realunit-sell.dto';
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
import { RealUnitStatsDto } from '../dto/realunit-stats.dto';
import { RealUnitStatsService } from '../realunit-stats.service';
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
    private readonly realUnitStatsService: RealUnitStatsService,
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
    @Query() { first, after }: AccountHistoryQueryDto,
  ): Promise<AccountHistoryDto> {
    return this.realunitService.getAccountHistory(address, first, after);
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
    summary: 'Get balance report PDF',
    description: 'Generates a PDF balance report for a specific address on Ethereum blockchain',
  })
  @ApiOkResponse({ type: PdfDto, description: 'Balance PDF report (base64 encoded)' })
  async getBalancePdf(@Body() dto: RealUnitBalancePdfDto): Promise<PdfDto> {
    const tokenBlockchain = [Environment.DEV, Environment.LOC].includes(Config.environment)
      ? Blockchain.SEPOLIA
      : Blockchain.ETHEREUM;
    const pdfData = await this.balancePdfService.generateBalancePdf(
      { ...dto, blockchain: tokenBlockchain },
      PdfBrand.REALUNIT,
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
      'Returns personal IBAN and payment details for purchasing REALU tokens. Requires KYC Level 30 and RealUnit registration.',
  })
  @ApiOkResponse({ type: RealUnitPaymentInfoDto })
  @ApiBadRequestResponse({ description: 'KYC Level 30 required, registration missing, or address not on allowlist' })
  async getPaymentInfo(@GetJwt() jwt: JwtPayload, @Body() dto: RealUnitBuyDto): Promise<RealUnitPaymentInfoDto> {
    const user = await this.userService.getUser(jwt.user, { userData: { kycSteps: true, country: true } });
    return this.realunitService.getPaymentInfo(user, dto);
  }

  @Put('buy/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), IpGuard)
  @ApiOkResponse({ type: RealUnitBuyConfirmDto, description: 'Payment confirmed' })
  async confirmBuy(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<RealUnitBuyConfirmDto> {
    return this.realunitService.confirmBuy(jwt.user, +id);
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
    const user = await this.userService.getUser(jwt.user, { userData: { kycSteps: true, country: true } });
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
    @Param('id') id: string,
    @Body() dto: RealUnitSellConfirmDto,
  ): Promise<{ txHash: string }> {
    return this.realunitService.confirmSell(jwt.user, +id, dto);
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
    @Param('id') id: string,
  ): Promise<{ swap: string; deposit: string }> {
    return this.realunitService.createSellUnsignedTransactions(jwt.user, +id);
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
    @Param('id') id: string,
    @Body() dto: RealUnitSellBroadcastDto,
  ): Promise<{ txHash: string }> {
    return this.realunitService.broadcastSellTransaction(jwt.user, +id, dto);
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
      userData: { kycSteps: true, country: true, nationality: true, organizationCountry: true, language: true },
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
      userData: { kycSteps: true, country: true, nationality: true, organizationCountry: true, language: true },
    });
    return this.realunitService.getRegistrationInfo(user.userData, jwt.address);
  }

  // --- Registration Endpoints ---

  @Get('register/status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Check if wallet is registered for RealUnit',
    description: 'Returns true if the connected wallet is registered for RealUnit, false otherwise',
  })
  @ApiOkResponse({ type: Boolean })
  async isRegistered(@GetJwt() jwt: JwtPayload): Promise<boolean> {
    const user = await this.userService.getUser(jwt.user, { userData: { kycSteps: true } });
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

  // --- Admin Endpoints ---

  @Get('admin/stats')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Get RealUnit KPI statistics' })
  @ApiOkResponse({
    type: RealUnitStatsDto,
    description: 'Aggregated RealUnit growth, KYC funnel, registration and trading KPIs',
  })
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getStats(): Promise<RealUnitStatsDto> {
    return this.realUnitStatsService.getStats();
  }

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

  @Put('admin/registration/:kycStepId/forward')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async forwardRegistration(@Param('kycStepId') kycStepId: string): Promise<void> {
    await this.realunitService.forwardRegistrationToAktionariat(+kycStepId);
  }
}
