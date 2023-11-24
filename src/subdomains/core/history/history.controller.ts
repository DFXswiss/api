import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyCryptoService } from '../buy-crypto/process/services/buy-crypto.service';
import { BuyFiatService } from '../sell-crypto/process/buy-fiat.service';
import { CoinTrackingHistoryDto } from './dto/coin-tracking-history.dto';
import { HistoryQuery } from './dto/history-query.dto';
import { HistoryDto, HistoryTransactionType, TypedHistoryDto } from './dto/history.dto';
import { HistoryService } from './history.service';

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
  @ApiOkResponse({ type: CoinTrackingHistoryDto, isArray: true })
  async getCoinTrackingApiHistory(
    @Query() query: HistoryQuery,
    @Headers('DFX-ACCESS-KEY') key: string,
    @Headers('DFX-ACCESS-SIGN') sign: string,
    @Headers('DFX-ACCESS-TIMESTAMP') timestamp: string,
  ): Promise<CoinTrackingHistoryDto[]> {
    const user = await this.userService.checkApiKey(key, sign, timestamp);
    query = Object.assign(query, this.apiKeyService.getFilter(user.apiFilterCT));

    return (await this.historyService.getHistory(user.id, user.address, query, 300000)).map((tx) => ({
      ...tx,
      date: tx.date?.getTime() / 1000,
    }));
  }

  @Post('csv')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse()
  async createCsv(@GetJwt() jwt: JwtPayload, @Query() query: HistoryQuery): Promise<number> {
    const csvFile = await this.historyService.getHistoryCsv(jwt.id, jwt.address, query);
    const fileKey = Util.randomId();
    this.files[fileKey] = new StreamableFile(csvFile);

    return fileKey;
  }

  @Get('csv')
  @ApiBearerAuth()
  @ApiOkResponse({ type: StreamableFile })
  async getCsv(@Query('key') key: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
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
  private addType(type: HistoryTransactionType): (history: HistoryDto[]) => TypedHistoryDto[] {
    return (history) => history.map((c) => ({ type, ...c }));
  }

  private formatDate(date: Date = new Date()): string {
    return Util.isoDateTime(date).split('-').join('');
  }
}
