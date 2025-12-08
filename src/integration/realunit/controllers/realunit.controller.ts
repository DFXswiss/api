import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import {
  AccountHistoryDto,
  AccountHistoryQueryDto,
  AccountSummaryDto,
  AllowlistStatusDto,
  BankDetailsDto,
  BrokerbotBroadcastRequest,
  BrokerbotBroadcastResponse,
  BrokerbotBuyPriceDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSellPriceDto,
  BrokerbotSellRequest,
  BrokerbotSellTxDto,
  BrokerbotSharesDto,
  HistoricalPriceDto,
  HistoricalPriceQueryDto,
  HoldersDto,
  HoldersQueryDto,
  Permit2ApprovalDto,
  Permit2ApproveRequest,
  Permit2ApproveTxDto,
  RealUnitAtomicSellRequest,
  RealUnitAtomicSellResponse,
  TimeFrame,
  TokenInfoDto,
} from '../dto/realunit.dto';
import { RealUnitService } from '../realunit.service';

@ApiTags('Realunit')
@Controller('realunit')
export class RealUnitController {
  constructor(private readonly realunitService: RealUnitService) {}

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

  @Get('brokerbot/sellPrice')
  @ApiOperation({
    summary: 'Get sell price for shares',
    description: 'Calculates the total proceeds from selling a specific number of REALU shares',
  })
  @ApiQuery({ name: 'shares', type: Number, description: 'Number of shares to sell' })
  @ApiOkResponse({ type: BrokerbotSellPriceDto })
  async getBrokerbotSellPrice(@Query('shares') shares: number): Promise<BrokerbotSellPriceDto> {
    return this.realunitService.getBrokerbotSellPrice(Number(shares));
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

  @Get('allowlist/:address')
  @ApiOperation({
    summary: 'Check allowlist status',
    description: 'Checks if a wallet address is allowed to receive REALU tokens',
  })
  @ApiParam({ name: 'address', description: 'Wallet address to check' })
  @ApiOkResponse({ type: AllowlistStatusDto })
  async getAllowlistStatus(@Param('address') address: string): Promise<AllowlistStatusDto> {
    return this.realunitService.getAllowlistStatus(address);
  }

  @Get('bank')
  @ApiOperation({
    summary: 'Get bank details',
    description: 'Retrieves bank account details for REALU purchases via bank transfer',
  })
  @ApiOkResponse({ type: BankDetailsDto })
  getBankDetails(): BankDetailsDto {
    return this.realunitService.getBankDetails();
  }

  // --- Sell Endpoints ---

  @Post('brokerbot/sell')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER))
  @ApiOperation({
    summary: 'Prepare sell transaction',
    description:
      'Prepares transaction data for selling REALU shares via Brokerbot. ' +
      'Returns both Brokerbot TX data and Permit2 signature data. ' +
      'Client signs both and sends to POST /realunit/sell for atomic execution.',
  })
  @ApiCreatedResponse({ type: BrokerbotSellTxDto })
  async prepareSellTx(
    @GetJwt() _jwt: JwtPayload,
    @Body() dto: BrokerbotSellRequest,
  ): Promise<BrokerbotSellTxDto> {
    return this.realunitService.prepareSellTx(dto.shares, dto.walletAddress, dto.minPrice);
  }

  @Post('brokerbot/broadcast')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER))
  @ApiOperation({
    summary: 'Broadcast signed sell transaction',
    description:
      'Validates and broadcasts a signed Brokerbot sell transaction (REALU → ZCHF). ' +
      'After this succeeds, use PUT /sell/paymentInfos and PUT /sell/paymentInfos/:id/confirm ' +
      'to complete the ZCHF → CHF sale via Permit2.',
  })
  @ApiCreatedResponse({ type: BrokerbotBroadcastResponse })
  async broadcastSellTx(
    @GetJwt() _jwt: JwtPayload,
    @Body() dto: BrokerbotBroadcastRequest,
  ): Promise<BrokerbotBroadcastResponse> {
    return this.realunitService.broadcastSellTx(dto.signedTransaction);
  }

  // --- Permit2 Approval Endpoints ---

  @Get('brokerbot/approval/:address')
  @ApiOperation({
    summary: 'Check Permit2 approval status',
    description: 'Checks the ZCHF allowance for the Permit2 contract for a given wallet address',
  })
  @ApiParam({ name: 'address', description: 'Wallet address to check' })
  @ApiOkResponse({ type: Permit2ApprovalDto })
  async getPermit2Approval(@Param('address') address: string): Promise<Permit2ApprovalDto> {
    return this.realunitService.getPermit2Approval(address);
  }

  @Post('brokerbot/approve')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER))
  @ApiOperation({
    summary: 'Prepare Permit2 approval transaction',
    description:
      'Prepares transaction data for approving ZCHF to the Permit2 contract. ' +
      'This is required once before using Permit2 for gasless ZCHF transfers.',
  })
  @ApiCreatedResponse({ type: Permit2ApproveTxDto })
  async prepareApproveTx(
    @GetJwt() _jwt: JwtPayload,
    @Body() dto: Permit2ApproveRequest,
  ): Promise<Permit2ApproveTxDto> {
    return this.realunitService.prepareApproveTx(dto.unlimited ?? true);
  }

  // --- Atomic Sell Endpoint ---

  @Post('sell')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER))
  @ApiOperation({
    summary: 'Atomic REALU sell',
    description:
      'Executes an atomic REALU sell: validates both the signed Brokerbot TX and Permit2 signature, ' +
      'verifies amounts match, broadcasts Brokerbot TX (REALU → ZCHF), ' +
      'then executes Permit2 transfer (ZCHF → DFX). Only succeeds if both operations complete.',
  })
  @ApiCreatedResponse({ type: RealUnitAtomicSellResponse })
  async atomicSell(
    @GetJwt() _jwt: JwtPayload,
    @Body() dto: RealUnitAtomicSellRequest,
  ): Promise<RealUnitAtomicSellResponse> {
    return this.realunitService.executeAtomicSell(dto.signedBrokerbotTx, dto.permit);
  }
}
