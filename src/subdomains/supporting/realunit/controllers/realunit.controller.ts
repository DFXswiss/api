import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { PdfBrand } from 'src/shared/utils/pdf.util';
import { PdfDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/pdf.dto';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BalancePdfService } from '../../balance/services/balance-pdf.service';
import { TxStatementType } from '../../payment/dto/transaction-helper/tx-statement-details.dto';
import { SwissQRService } from '../../payment/services/swiss-qr.service';
import { TransactionHelper } from '../../payment/services/transaction-helper';
import { RealUnitBalancePdfDto, RealUnitMultiReceiptPdfDto } from '../dto/realunit-pdf.dto';
import {
  RealUnitRegistrationDto,
  RealUnitRegistrationResponseDto,
  RealUnitRegistrationStatus,
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
    private readonly transactionHelper: TransactionHelper,
    private readonly swissQrService: SwissQRService,
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

  // --- Balance PDF Endpoint ---

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

  // --- Receipt PDF Endpoint ---

  @Put('transaction/:id/receipt')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    description: 'Generates a PDF receipt for a completed RealUnit transaction',
  })
  @ApiParam({ name: 'id', description: 'Transaction ID' })
  @ApiOkResponse({ type: PdfDto, description: 'Receipt PDF (base64 encoded)' })
  @ApiBadRequestResponse({ description: 'Transaction not found or not a RealUnit transaction' })
  async generateReceipt(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<PdfDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });

    const txStatementDetails = await this.transactionHelper.getTxStatementDetails(
      user.userData.id,
      +id,
      TxStatementType.RECEIPT,
    );

    if (!Config.invoice.currencies.includes(txStatementDetails.currency)) {
      throw new BadRequestException('PDF receipt is only available for CHF and EUR transactions');
    }

    return { pdfData: await this.swissQrService.createTxStatement(txStatementDetails, PdfBrand.REALUNIT) };
  }

  @Post('transactions/receipt/multi')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  @ApiOperation({
    description: 'Generates a single PDF receipt for multiple completed RealUnit transactions',
  })
  @ApiOkResponse({ type: PdfDto, description: 'Receipt PDF (base64 encoded)' })
  @ApiBadRequestResponse({ description: 'Transaction not found, currency mismatch, or not a RealUnit transaction' })
  async generateMultiReceipt(@GetJwt() jwt: JwtPayload, @Body() dto: RealUnitMultiReceiptPdfDto): Promise<PdfDto> {
    const user = await this.userService.getUser(jwt.user, { userData: true });

    const txStatementDetails = await this.transactionHelper.getTxStatementDetailsMulti(
      user.userData.id,
      dto.transactionIds,
      TxStatementType.RECEIPT,
    );

    if (txStatementDetails.length > 0 && !Config.invoice.currencies.includes(txStatementDetails[0].currency)) {
      throw new BadRequestException('PDF receipt is only available for CHF and EUR transactions');
    }

    return { pdfData: await this.swissQrService.createMultiTxStatement(txStatementDetails, PdfBrand.REALUNIT) };
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
      'Returns personal IBAN and payment details for purchasing REALU tokens. Requires KYC Level 50 and RealUnit registration.',
  })
  @ApiOkResponse({ type: RealUnitPaymentInfoDto })
  @ApiBadRequestResponse({ description: 'KYC Level 50 required, registration missing, or address not on allowlist' })
  async getPaymentInfo(@GetJwt() jwt: JwtPayload, @Body() dto: RealUnitBuyDto): Promise<RealUnitPaymentInfoDto> {
    const user = await this.userService.getUser(jwt.user, { userData: { kycSteps: true, country: true } });
    return this.realunitService.getPaymentInfo(user, dto);
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

  // --- Registration Endpoint ---

  @Post('register')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOperation({ summary: 'Register for RealUnit' })
  @ApiOkResponse({ type: RealUnitRegistrationResponseDto, description: 'Registration completed successfully' })
  @ApiAcceptedResponse({
    type: RealUnitRegistrationResponseDto,
    description: 'Registration accepted, pending manual review',
  })
  @ApiBadRequestResponse({ description: 'Invalid signature or wallet does not belong to user' })
  async register(@GetJwt() jwt: JwtPayload, @Body() dto: RealUnitRegistrationDto, @Res() res: Response): Promise<void> {
    const needsReview = await this.realunitService.register(jwt.account, dto);

    const response: RealUnitRegistrationResponseDto = {
      status: needsReview ? RealUnitRegistrationStatus.PENDING_REVIEW : RealUnitRegistrationStatus.COMPLETED,
    };

    res.status(needsReview ? HttpStatus.ACCEPTED : HttpStatus.OK).json(response);
  }

  // --- Admin Endpoints ---

  @Put('admin/registration/:kycStepId/forward')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async forwardRegistration(@Param('kycStepId') kycStepId: string): Promise<void> {
    await this.realunitService.forwardRegistrationToAktionariat(+kycStepId);
  }
}
