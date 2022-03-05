import { Controller, UseGuards, Get, StreamableFile, Response, Post, Query, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/util';
import { HistoryQuery } from './dto/history-query.dto';
import { CoinTrackingHistoryDto, HistoryDto } from './dto/history.dto';
import { HistoryService } from './history.service';

@ApiTags('history')
@Controller('history')
export class HistoryController {
  private files: { [key: number]: StreamableFile } = {};

  constructor(private readonly historyService: HistoryService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getHistory(
    @GetJwt() jwt: JwtPayload,
    @Query() query: HistoryQuery,
  ): Promise<HistoryDto[] | CoinTrackingHistoryDto[]> {
    const tx = await this.historyService.getHistory(jwt.id, jwt.address, query);
    // return jwt.role === UserRole.CT ? tx.map((t) => ({ ...t, ...{ date: t.date?.getTime() / 1000 } })) : tx;
    return tx;
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
