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
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSharesDto,
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
  RealUnitRegistrationResponseDto,
  RealUnitRegistrationStatus,
  RealUnitWalletStatusDto,
} from '../dto/realunit-registration.dto';
import { RealUnitSellConfirmDto, RealUnitSellDto, RealUnitSellPaymentInfoDto } from '../dto/realunit-sell.dto';
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

  // --- Brokerbot Endpoints ---

  @Get('brokerbot/info')
  @ApiOperation({
    summary: 'Get Brokerbot info',
    description: 'Retrieves general information about the REALU Brokerbot (addresses, settings)',
  })
  @ApiOkResponse({ type: BrokerbotInfoDto })
  async getBrokerbotInfo(): Promise<BrokerbotInfoDto> {
    return this.realunitService.getBrokerbotInfo();
  }

  @Get('brokerbot/price')
  @ApiOperation({
    summary: 'Get current Brokerbot price',
    description: 'Retrieves the current price per REALU share from the Brokerbot smart contract',
  })
  @ApiOkResponse({ type: BrokerbotPriceDto })
  async getBrokerbotPrice(): Promise<BrokerbotPriceDto> {
    return this.realunitService.getBrokerbotPrice();
  }

  @Get('brokerbot/buyPrice')
  @ApiOperation({
    summary: 'Get buy price for shares',
    description: 'Calculates the total cost to buy a specific number of REALU shares (includes price increment)',
  })
  @ApiQuery({ name: 'shares', type: Number, description: 'Number of shares to buy' })
  @ApiOkResponse({ type: BrokerbotBuyPriceDto })
  async getBrokerbotBuyPrice(@Query('shares') shares: number): Promise<BrokerbotBuyPriceDto> {
    return this.realunitService.getBrokerbotBuyPrice(Number(shares));
  }

  @Get('brokerbot/shares')
  @ApiOperation({
    summary: 'Get shares for amount',
    description: 'Calculates how many REALU shares can be purchased for a given CHF amount',
  })
  @ApiQuery({ name: 'amount', type: String, description: 'Amount in CHF (e.g., "1000.50")' })
  @ApiOkResponse({ type: BrokerbotSharesDto })
  async getBrokerbotShares(@Query('amount') amount: string): Promise<BrokerbotSharesDto> {
    return this.realunitService.getBrokerbotShares(amount);
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
      'Returns EIP-7702 delegation data for gasless REALU transfer and fallback deposit info. Requires KYC Level 20 and RealUnit registration.',
  })
  @ApiOkResponse({ type: RealUnitSellPaymentInfoDto })
  @ApiBadRequestResponse({ description: 'KYC Level 20 required or registration missing' })
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

  // --- Wallet Status Endpoint ---

  @Get('wallet/status')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    summary: 'Get wallet status and user data',
    description:
      'Returns registration status for the connected wallet and user data if available. Can be used to check registration, get data for account merge, or display user profile.',
  })
  @ApiOkResponse({ type: RealUnitWalletStatusDto })
  async getWalletStatus(@GetJwt() jwt: JwtPayload): Promise<RealUnitWalletStatusDto> {
    const user = await this.userService.getUser(jwt.user, { userData: { kycSteps: true } });
    return this.realunitService.getAddressWalletStatus(user.userData, jwt.address);
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
    const statusCode = status === RealUnitRegistrationStatus.COMPLETED ? HttpStatus.CREATED : HttpStatus.ACCEPTED;
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
    const statusCode = status === RealUnitRegistrationStatus.COMPLETED ? HttpStatus.CREATED : HttpStatus.ACCEPTED;
    res.status(statusCode).json(response);
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

  @Put('admin/registration/:kycStepId/forward')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async forwardRegistration(@Param('kycStepId') kycStepId: string): Promise<void> {
    await this.realunitService.forwardRegistrationToAktionariat(+kycStepId);
  }
}
