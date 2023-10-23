import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Post,
  Query,
  Res,
  Response,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyCryptoService } from '../buy-crypto/process/services/buy-crypto.service';
import { BuyFiatService } from '../sell-crypto/process/buy-fiat.service';
import { ExportDataType, HistoryQuery, HistoryQueryExportType, HistoryQueryUser } from './dto/history-query.dto';
import { HistoryDto, HistoryDtoDeprecated, HistoryTransactionType, TypedHistoryDto } from './dto/history.dto';
import { ChainReportCsvHistoryDto } from './dto/output/chain-report-history.dto';
import { CoinTrackingApiHistoryDto, CoinTrackingCsvHistoryDto } from './dto/output/coin-tracking-history.dto';
import { CompactHistoryDto } from './dto/output/compact-history.dto';
import { ExportType, HistoryService } from './history.service';

@ApiTags('History')
@Controller('history')
export class HistoryController {
  private files: { [key: number]: StreamableFile } = {};

  constructor(
    private readonly historyService: HistoryService,
    private readonly userService: UserService,
    private readonly apiKeyService: ApiKeyService,
    private readonly buyFiatService: BuyFiatService,
    private readonly buyCryptoService: BuyCryptoService,
  ) {}

  @Get('compact')
  @ApiOkResponse({ type: CompactHistoryDto, isArray: true })
  async getCsvCompact(
    @Query() query: HistoryQueryUser,
    @Response({ passthrough: true }) res,
  ): Promise<CompactHistoryDto[] | StreamableFile> {
    return this.getHistoryData(query, ExportType.COMPACT, res);
  }

  @Get('CoinTracking')
  @ApiOkResponse({ type: CoinTrackingCsvHistoryDto, isArray: true })
  async getCsvCT(
    @Query() query: HistoryQueryUser,
    @Response({ passthrough: true }) res,
  ): Promise<CoinTrackingCsvHistoryDto[] | StreamableFile> {
    return this.getHistoryData(query, ExportType.COIN_TRACKING, res);
  }

  @Get('ChainReport')
  @ApiOkResponse({ status: 200, type: ChainReportCsvHistoryDto, isArray: true })
  async getCsvChainReport(
    @Query() query: HistoryQueryUser,
    @Response({ passthrough: true }) res,
  ): Promise<ChainReportCsvHistoryDto[] | StreamableFile> {
    return this.getHistoryData(query, ExportType.CHAIN_REPORT, res);
  }

  // --- DEPRECATED ENDPOINTS --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: TypedHistoryDto, isArray: true })
  async getHistory(@GetJwt() jwt: JwtPayload): Promise<TypedHistoryDto[]> {
    return [
      await this.buyCryptoService.getBuyHistory(jwt.id).then(this.addType(HistoryTransactionType.BUY)),
      await this.buyCryptoService.getCryptoHistory(jwt.id).then(this.addType(HistoryTransactionType.CRYPTO)),
      await this.buyFiatService.getSellHistory(jwt.id).then(this.addType(HistoryTransactionType.SELL)),
    ]
      .reduce((prev, curr) => prev.concat(curr), [])
      .sort((tx1, tx2) => (tx1.date > tx2.date ? -1 : 1));
  }

  @Get('CT')
  @ApiOkResponse({ type: CoinTrackingApiHistoryDto, isArray: true })
  async getCoinTrackingApiHistory(
    @Query() query: HistoryQuery,
    @Headers('DFX-ACCESS-KEY') key: string,
    @Headers('DFX-ACCESS-SIGN') sign: string,
    @Headers('DFX-ACCESS-TIMESTAMP') timestamp: string,
  ): Promise<CoinTrackingApiHistoryDto[]> {
    const user = await this.userService.checkApiKey(key, sign, timestamp);
    query = Object.assign(query, this.apiKeyService.getFilter(user.apiFilterCT));

    return (
      await this.historyService.getJsonHistory(
        { format: ExportDataType.JSON, userAddress: user.address, ...query },
        ExportType.COIN_TRACKING,
      )
    ).map((tx) => ({
      ...tx,
      date: tx.date?.getTime() / 1000,
    }));
  }

  @Post('csv')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse()
  async createCsv(@GetJwt() jwt: JwtPayload, @Query() query: HistoryQueryExportType): Promise<number> {
    const csvFile = await this.historyService.getCsvHistory({ ...query, userAddress: jwt.address }, query.type);
    const fileKey = Util.randomId();
    this.files[fileKey] = csvFile;

    return fileKey;
  }

  @Get('csv')
  @ApiBearerAuth()
  @ApiOkResponse({ type: StreamableFile })
  async getCsv(@Query('key') key: string, @Res({ passthrough: true }) res): Promise<StreamableFile> {
    const csvFile = this.files[+key];
    if (!csvFile) throw new NotFoundException('File not found');
    delete this.files[+key];

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="DFX_history_${this.formatDate()}.csv"`,
    });
    return csvFile;
  }

  // --- HELPER METHODS --- //
  private addType(type: HistoryTransactionType): (history: HistoryDtoDeprecated[]) => TypedHistoryDto[] {
    return (history) => history.map((c) => ({ type, ...c }));
  }

  private formatDate(date: Date = new Date()): string {
    return date.toISOString().split('-').join('').split(':').join('').split('T').join('_').split('.')[0];
  }

  private async getHistoryData<T extends ExportType>(
    query: HistoryQueryUser,
    exportType: T,
    res: any,
  ): Promise<HistoryDto<T>[] | StreamableFile> {
    const tx = await this.historyService.getHistory(query, exportType);
    if (query.format === ExportDataType.CSV)
      res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="DFX_${exportType}_history_${this.formatDate()}.csv"`,
      });
    return tx;
  }
}
