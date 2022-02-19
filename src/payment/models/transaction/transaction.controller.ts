import { Controller, UseGuards, Get, StreamableFile, Response, Post, Query, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/util';
import { CoinTrackingTransactionDto, TransactionDto } from './dto/transaction.dto';
import { TransactionService } from './transaction.service';

@ApiTags('transaction')
@Controller('transaction')
export class TransactionController {
  private files: { [key: number]: StreamableFile } = {};

  constructor(private readonly transactionService: TransactionService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getTransactions(@GetJwt() jwt: JwtPayload): Promise<TransactionDto[] | CoinTrackingTransactionDto[]> {
    const tx = await this.transactionService.getTransactions(jwt.id, jwt.address);
    // return jwt.role === UserRole.CT ? tx.map((t) => ({ ...t, ...{ date: t.date?.getTime() / 1000 } })) : tx;
    return tx;
  }

  @Post('csv')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async createCsv(@GetJwt() jwt: JwtPayload): Promise<number> {
    const csvFile = await this.transactionService.getTransactionCsv(jwt.id, jwt.address);
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
