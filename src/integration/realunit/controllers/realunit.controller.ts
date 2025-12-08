import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RealUnitRegistrationDto } from 'src/subdomains/generic/kyc/dto/input/realunit-registration.dto';
import { RealUnitRegistrationService } from 'src/subdomains/generic/kyc/services/realunit-registration.service';
import {
  AccountHistoryDto,
  AccountHistoryQueryDto,
  AccountSummaryDto,
  AllowlistStatusDto,
  BankDetailsDto,
  BrokerbotBuyPriceDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSharesDto,
  HistoricalPriceDto,
  HistoricalPriceQueryDto,
  HoldersDto,
  HoldersQueryDto,
  TimeFrame,
  TokenInfoDto,
} from '../dto/realunit.dto';
import { RealUnitService } from '../realunit.service';

@ApiTags('Realunit')
@Controller('realunit')
export class RealUnitController {
  constructor(
    private readonly realunitService: RealUnitService,
    private readonly realUnitRegistrationService: RealUnitRegistrationService,
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

  // --- Registration Endpoint ---

  @Post('register')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOperation({ summary: 'Register for RealUnit' })
  @ApiCreatedResponse({ description: 'Registration saved successfully' })
  @ApiBadRequestResponse({ description: 'Invalid signature or wallet does not belong to user' })
  async register(@GetJwt() jwt: JwtPayload, @Body() dto: RealUnitRegistrationDto): Promise<{ id: number }> {
    const kycStep = await this.realUnitRegistrationService.register(jwt.account, dto);
    return { id: kycStep.id };
  }
}
