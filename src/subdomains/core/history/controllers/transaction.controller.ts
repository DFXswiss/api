import {
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  Res,
  Response,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
import { ExportFormat, HistoryQueryExportType, HistoryQueryUser } from '../dto/history-query.dto';
import { HistoryDto } from '../dto/history.dto';
import { ChainReportCsvHistoryDto } from '../dto/output/chain-report-history.dto';
import { CoinTrackingCsvHistoryDto } from '../dto/output/coin-tracking-history.dto';
import { CompactHistoryDto } from '../dto/output/compact-history.dto';
import { ExportType, HistoryService } from '../services/history.service';

@ApiTags('Transaction')
@Controller('transaction')
export class HistoryController {
  private files: { [key: number]: StreamableFile } = {};

  constructor(private readonly historyService: HistoryService) {}

  @Get('compact')
  @ApiOkResponse({ type: CompactHistoryDto, isArray: true })
  async getCsvCompact(
    @Query() query: HistoryQueryUser,
    @Response({ passthrough: true }) res,
  ): Promise<CompactHistoryDto[] | StreamableFile> {
    query.format = ExportFormat.JSON;
    return this.getHistoryData(query, ExportType.COMPACT, res);
  }

  @Get('CoinTracking')
  @ApiOkResponse({ type: CoinTrackingCsvHistoryDto, isArray: true })
  @ApiExcludeEndpoint()
  async getCsvCT(
    @Query() query: HistoryQueryUser,
    @Response({ passthrough: true }) res,
  ): Promise<CoinTrackingCsvHistoryDto[] | StreamableFile> {
    return this.getHistoryData(query, ExportType.COIN_TRACKING, res);
  }

  @Get('ChainReport')
  @ApiOkResponse({ status: 200, type: ChainReportCsvHistoryDto, isArray: true })
  @ApiExcludeEndpoint()
  async getCsvChainReport(
    @Query() query: HistoryQueryUser,
    @Response({ passthrough: true }) res,
  ): Promise<ChainReportCsvHistoryDto[] | StreamableFile> {
    return this.getHistoryData(query, ExportType.CHAIN_REPORT, res);
  }

  @Post('csv')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
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
  @ApiExcludeEndpoint()
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

  private formatDate(date: Date = new Date()): string {
    return date.toISOString().split('-').join('').split(':').join('').split('T').join('_').split('.')[0];
  }

  private async getHistoryData<T extends ExportType>(
    query: HistoryQueryUser,
    exportType: T,
    res: any,
  ): Promise<HistoryDto<T>[] | StreamableFile> {
    const tx = await this.historyService.getHistory(query, exportType);
    if (query.format === ExportFormat.CSV)
      res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="DFX_${exportType}_history_${this.formatDate()}.csv"`,
      });
    return tx;
  }
}
