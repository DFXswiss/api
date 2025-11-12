import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccountHistoryDto, AccountSummaryDto, HistoricalPriceDto, HoldersDto, TimeFrame } from '../dto/realunit.dto';
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
  @ApiQuery({
    name: 'first',
    required: false,
    type: Number,
    description: 'Number of history events to return (default: 50)',
  })
  @ApiQuery({
    name: 'after',
    required: false,
    type: String,
    description: 'Cursor for pagination - return events after this cursor',
  })
  async getAccountHistory(
    @Param('address') address: string,
    @Query('first') first?: number,
    @Query('after') after?: string,
  ): Promise<AccountHistoryDto> {
    return this.realunitService.getAccountHistory(address, first, after);
  }

  @Get('holders')
  @ApiOperation({
    summary: 'Get token holders',
    description: 'Retrieves a paginated list of token holders on the Realunit protocol',
  })
  @ApiQuery({
    name: 'first',
    required: false,
    type: Number,
    description: 'Number of holders to return (default: 50)',
  })
  @ApiQuery({
    name: 'after',
    required: false,
    type: String,
    description:
      'Cursor for pagination - return holders after this cursor, cursor is the endCursor of the previous page',
  })
  @ApiOkResponse({ type: HoldersDto })
  async getHolders(@Query('first') first?: number, @Query('after') after?: string): Promise<HoldersDto> {
    return this.realunitService.getHolders(first, after);
  }

  @Get('price/history')
  @ApiOperation({
    summary: 'Get historical prices',
    description: 'Retrieves the historical prices of RealUnit token in multiple currencies (CHF, EUR, USD)',
  })
  @ApiQuery({
    name: 'timeFrame',
    required: false,
    enum: TimeFrame,
    description: 'Time frame for historical prices (default: WEEK)',
  })
  @ApiOkResponse({ type: [HistoricalPriceDto] })
  async getHistoricalPrice(@Query('timeFrame') timeFrame: TimeFrame = TimeFrame.WEEK): Promise<HistoricalPriceDto[]> {
    return this.realunitService.getHistoricalPrice(timeFrame);
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
}
