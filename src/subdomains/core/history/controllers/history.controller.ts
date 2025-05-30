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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeController,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { ParallelQueue } from 'src/shared/utils/parallel-queue';
import { Util } from 'src/shared/utils/util';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionDto } from '../../../supporting/payment/dto/transaction.dto';
import { ExportFormat, HistoryQuery, HistoryQueryExportType, HistoryQueryUser } from '../dto/history-query.dto';
import { TypedHistoryDto } from '../dto/history.dto';
import { CoinTrackingApiHistoryDto } from '../dto/output/coin-tracking-history.dto';
import { ExportType, HistoryService } from '../services/history.service';
import { TransactionController } from './transaction.controller';

@ApiTags('History')
@Controller('history')
@ApiExcludeController()
export class HistoryController {
  private files: { [key: number]: StreamableFile } = {};

  constructor(
    private readonly historyService: HistoryService,
    private readonly transactionController: TransactionController,
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
  ) {}

  // --- DEPRECATED ENDPOINTS --- //
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: TypedHistoryDto, isArray: true })
  @ApiExcludeEndpoint()
  async getHistory(
    @Query() query: HistoryQueryUser,
    @Response({ passthrough: true }) res,
  ): Promise<TransactionDto[] | StreamableFile> {
    if (!query.format) query.format = ExportFormat.JSON;
    return this.transactionController.getHistoryData(query, ExportType.COMPACT, res);
  }

  @Get('CT')
  @ApiOkResponse({ type: CoinTrackingApiHistoryDto, isArray: true })
  @ApiExcludeEndpoint()
  @ParallelQueue(5)
  async getCoinTrackingApiHistory(
    @Query() query: HistoryQuery,
    @Headers('DFX-ACCESS-KEY') key: string,
    @Headers('DFX-ACCESS-SIGN') sign: string,
    @Headers('DFX-ACCESS-TIMESTAMP') timestamp: string,
  ): Promise<CoinTrackingApiHistoryDto[]> {
    const user = key.endsWith('0')
      ? await this.userService.checkApiKey(key, sign, timestamp)
      : await this.userDataService.checkApiKey(key, sign, timestamp);
    query = Object.assign(query, ApiKeyService.getFilter(user.apiFilterCT));

    return this.historyService
      .getJsonHistory(user, { format: ExportFormat.JSON, ...query }, ExportType.COIN_TRACKING)
      .then((h) =>
        h.map((tx) => ({
          ...tx,
          date: tx.date?.getTime() / 1000,
        })),
      );
  }

  @Post('csv')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  @ApiCreatedResponse()
  async createCsv(@GetJwt() jwt: JwtPayload, @Query() query: HistoryQueryExportType): Promise<number> {
    const csvFile = await this.historyService.getCsvHistory(
      { ...query, userAddress: jwt.address, format: ExportFormat.CSV },
      query.type,
    );
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
      'Content-Disposition': `attachment; filename="DFX_history_${Util.filenameDate()}.csv"`,
    });
    return csvFile;
  }
}
