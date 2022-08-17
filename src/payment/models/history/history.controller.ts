import {
  Controller,
  UseGuards,
  Get,
  StreamableFile,
  Response,
  Post,
  Query,
  NotFoundException,
  Headers,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { Util } from 'src/shared/util';
import { UserService } from 'src/user/models/user/user.service';
import { HistoryQuery } from './dto/history-query.dto';
import { CoinTrackingHistoryDto, HistoryDto } from './dto/history.dto';
import { HistoryService } from './history.service';

@ApiTags('history')
@Controller('history')
export class HistoryController {
  private files: { [key: number]: StreamableFile } = {};

  constructor(
    private readonly historyService: HistoryService,
    private readonly userService: UserService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getHistory(
    @GetJwt() jwt: JwtPayload,
    @Query() query: HistoryQuery,
  ): Promise<HistoryDto[] | CoinTrackingHistoryDto[]> {
    return await this.historyService.getHistory(jwt.id, jwt.address, query);
  }

  @Get('CT')
  async getCoinTrackingApiHistory(
    @Query() query: HistoryQuery,
    @Headers('DFX-ACCESS-KEY') key: string,
    @Headers('DFX-ACCESS-SIGN') sign: string,
    @Headers('DFX-ACCESS-TIMESTAMP') timestamp: string,
  ): Promise<CoinTrackingHistoryDto[]> {
    const user = await this.userService.checkApiKey(key, sign, timestamp);
    const filter = this.apiKeyService.getFilter(user.apiKeyCT, user.apiKeyFilterCode);
    query = Object.assign(query, filter);

    const tx = await this.historyService.getHistory(user.id, user.address, query, 300000);
    return tx.map((t) => ({ ...t, ...{ date: t.date?.getTime() / 1000 } }));
  }

  @Post('csv')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createCsv(@GetJwt() jwt: JwtPayload, @Query() query: HistoryQuery): Promise<number> {
    const csvFile = await this.historyService.getHistoryCsv(jwt.id, jwt.address, query);
    const fileKey = Util.randomId();
    this.files[fileKey] = new StreamableFile(csvFile);

    return fileKey;
  }

  @Get('csv')
  @ApiBearerAuth()
  async getCsv(@Query('key') key: string, @Response({ passthrough: true }) res): Promise<StreamableFile> {
    const csvFile = this.files[+key];
    if (!csvFile) throw new NotFoundException('File not found');
    delete this.files[+key];

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="DFX_history_${this.formatDate()}.csv"`,
    });
    return csvFile;
  }

  private formatDate(date: Date = new Date()): string {
    return date.toISOString().split('-').join('').split(':').join('').split('T').join('_').split('.')[0];
  }
}
