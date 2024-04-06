import {
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Util } from 'src/shared/utils/util';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankTxType, BankTxTypeUnassigned } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import {
  TransactionDetailDto,
  TransactionDto,
  TransactionTarget,
  UnassignedTransactionDto,
} from '../../../supporting/payment/dto/transaction.dto';
import { BuyCryptoWebhookService } from '../../buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { RefRewardService } from '../../referral/reward/ref-reward.service';
import { BuyFiatService } from '../../sell-crypto/process/services/buy-fiat.service';
import { ExportFormat, HistoryQueryExportType, HistoryQueryUser } from '../dto/history-query.dto';
import { HistoryDto } from '../dto/history.dto';
import { ChainReportCsvHistoryDto } from '../dto/output/chain-report-history.dto';
import { CoinTrackingCsvHistoryDto } from '../dto/output/coin-tracking-history.dto';
import { TransactionFilter } from '../dto/transaction-filter.dto';
import { TransactionDtoMapper } from '../mappers/transaction-dto.mapper';
import { ExportType, HistoryService } from '../services/history.service';

@ApiTags('Transaction')
@Controller('transaction')
export class TransactionController {
  private files: { [key: string]: StreamableFile } = {};

  constructor(
    private readonly historyService: HistoryService,
    private readonly userService: UserService,
    private readonly transactionService: TransactionService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly buyFiatService: BuyFiatService,
    private readonly refRewardService: RefRewardService,
    private readonly bankDataService: BankDataService,
    private readonly bankTxService: BankTxService,
    private readonly fiatService: FiatService,
    private readonly buyService: BuyService,
  ) {}

  // --- OPEN ENDPOINTS --- //
  @Get()
  @ApiOkResponse({ type: TransactionDto, isArray: true })
  async getCsvCompact(
    @Query() query: HistoryQueryUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransactionDto[] | StreamableFile> {
    if (!query.format) query.format = ExportFormat.JSON;
    return this.getHistoryData(query, ExportType.COMPACT, res);
  }

  @Get('CoinTracking')
  @ApiOkResponse({ type: CoinTrackingCsvHistoryDto, isArray: true })
  @ApiExcludeEndpoint()
  async getCsvCT(
    @Query() query: HistoryQueryUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CoinTrackingCsvHistoryDto[] | StreamableFile> {
    if (!query.format) query.format = ExportFormat.CSV;
    return this.getHistoryData(query, ExportType.COIN_TRACKING, res);
  }

  @Get('ChainReport')
  @ApiOkResponse({ type: ChainReportCsvHistoryDto, isArray: true })
  @ApiExcludeEndpoint()
  async getCsvChainReport(
    @Query() query: HistoryQueryUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChainReportCsvHistoryDto[] | StreamableFile> {
    if (!query.format) query.format = ExportFormat.CSV;
    return this.getHistoryData(query, ExportType.CHAIN_REPORT, res);
  }

  // --- AUTHORIZED ENDPOINTS --- //
  @Get('detail')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: TransactionDetailDto, isArray: true })
  async getTransactionDetails(
    @GetJwt() jwt: JwtPayload,
    @Query() query: TransactionFilter,
  ): Promise<TransactionDetailDto[]> {
    return this.getAllTransactions(jwt.id, query);
  }

  @Put('detail/csv')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse()
  @ApiOperation({ description: 'Initiate CSV history export' })
  async createDetailCsv(@GetJwt() jwt: JwtPayload, @Query() query: TransactionFilter): Promise<string> {
    const transactions = await this.getAllTransactions(jwt.id, query);

    const csvFile = this.historyService.getCsv(transactions, ExportType.COMPACT);

    return this.cacheCsv(csvFile);
  }

  @Get('unassigned')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getUnassignedTransactions(@GetJwt() jwt: JwtPayload): Promise<UnassignedTransactionDto[]> {
    const user = await this.userService.getUser(jwt.id, { userData: true });
    const ibans = await this.bankDataService.getIbansForUser(user.userData.id);

    const txList = await this.bankTxService.getUnassignedBankTx(ibans);
    return Util.asyncMap(txList, async (tx) => {
      const currency = await this.fiatService.getFiatByName(tx.txCurrency);
      return TransactionDtoMapper.mapUnassignedTransaction(tx, currency);
    });
  }

  @Get('target')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async getTransactionTargets(@GetJwt() jwt: JwtPayload): Promise<TransactionTarget[]> {
    const buys = await this.buyService.getUserDataBuys(jwt.id);

    return buys.map((b) => ({
      id: b.id,
      address: b.user.address,
      asset: AssetDtoMapper.toDto(b.asset),
      bankUsage: b.bankUsage,
    }));
  }

  @Put(':id/target')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiExcludeEndpoint()
  async setTransactionTarget(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Query('buyId') buyId: string,
  ): Promise<void> {
    const transaction = await this.transactionService.getTransaction(+id, { bankTx: true });
    if (!transaction.bankTx) throw new NotFoundException('Transaction not found');
    if (!BankTxTypeUnassigned(transaction.bankTx.type)) throw new ConflictException('Transaction already assigned');

    const buy = await this.buyService.get(jwt.id, +buyId);
    if (!buy) throw new NotFoundException('Buy not found');

    const user = await this.userService.getUser(jwt.id, { userData: true });
    const ibans = await this.bankDataService.getIbansForUser(user.userData.id);
    if (!ibans.includes(transaction.bankTx.iban))
      throw new ForbiddenException('You can only assign your own transaction');

    await this.bankTxService.update(transaction.bankTx.id, { type: BankTxType.BUY_CRYPTO, buyId: buy.id });
  }

  // --- CSV ENDPOINTS --- //
  @Put('csv')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiCreatedResponse()
  @ApiOperation({ description: 'Initiate CSV history export' })
  async createCsv(@GetJwt() jwt: JwtPayload, @Query() query: HistoryQueryExportType): Promise<string> {
    const csvFile = await this.historyService.getCsvHistory(
      { ...query, userAddress: jwt.address, format: ExportFormat.CSV },
      query.type,
    );

    return this.cacheCsv(csvFile);
  }

  @Get('csv')
  @ApiBearerAuth()
  @ApiOkResponse({ type: StreamableFile })
  @ApiOperation({ description: 'Get initiated CSV history export' })
  async getCsv(@Query('key') key: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const csvFile = this.files[key];
    if (!csvFile) throw new NotFoundException('File not found');
    delete this.files[key];

    this.setCsvResult(res, ExportType.COMPACT);

    return csvFile;
  }

  // --- HELPER METHODS --- //

  private formatDate(date: Date = new Date()): string {
    return Util.isoDateTime(date).split('-').join('');
  }

  public async getHistoryData<T extends ExportType>(
    query: HistoryQueryUser,
    exportType: T,
    res: any,
  ): Promise<HistoryDto<T>[] | StreamableFile> {
    const tx = await this.historyService.getHistory(query, exportType);
    if (query.format === ExportFormat.CSV) this.setCsvResult(res, exportType);
    return tx;
  }

  private cacheCsv(csvFile: StreamableFile): string {
    const fileKey = Util.randomId().toString();
    this.files[fileKey] = csvFile;

    return fileKey;
  }

  private setCsvResult(res: Response, exportType: ExportType) {
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="DFX_${exportType}_history_${this.formatDate()}.csv"`,
    });
  }

  private async getAllTransactions(userId: number, query: TransactionFilter) {
    const user = await this.userService.getUser(userId, { userData: { users: true } });
    const txList = await this.transactionService.getTransactionsForUsers(user.userData.users, query.from, query.to);

    // map to DTO
    return Util.asyncMap(txList, async (tx) => {
      if (tx.buyCrypto) {
        const bc = await this.buyCryptoWebhookService.extendBuyCrypto(tx.buyCrypto);
        return TransactionDtoMapper.mapBuyCryptoTransactionDetail(bc);
      } else if (tx.buyFiat) {
        const bf = await this.buyFiatService.extendBuyFiat(tx.buyFiat);
        return TransactionDtoMapper.mapBuyFiatTransactionDetail(bf);
      } else if (tx.refReward) {
        const rr = await this.refRewardService.extendReward(tx.refReward);
        return TransactionDtoMapper.mapReferralRewardDetail(rr);
      }

      return undefined;
    }).then((list) => list.filter((dto) => dto));
  }
}
