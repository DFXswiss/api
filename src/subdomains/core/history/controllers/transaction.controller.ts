import {
  BadRequestException,
  Body,
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
import { CronExpression } from '@nestjs/schedule';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import * as IbanTools from 'ibantools';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { IpGuard } from 'src/shared/auth/ip.guard';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTxReturnService } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service';
import {
  BankTx,
  BankTxType,
  BankTxTypeUnassigned,
} from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { CardBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { FindOptionsRelations } from 'typeorm';
import {
  TransactionDetailDto,
  TransactionDto,
  TransactionTarget,
  TransactionType,
  UnassignedTransactionDto,
} from '../../../supporting/payment/dto/transaction.dto';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoWebhookService } from '../../buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyCryptoService } from '../../buy-crypto/process/services/buy-crypto.service';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { BankInfoDto } from '../../buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { InvoiceDto } from '../../buy-crypto/routes/buy/dto/invoice.dto';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { RefRewardService } from '../../referral/reward/services/ref-reward.service';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from '../../sell-crypto/process/services/buy-fiat.service';
import { SellService } from '../../sell-crypto/route/sell.service';
import { TransactionUtilService } from '../../transaction/transaction-util.service';
import { ExportFormat, HistoryQueryUser } from '../dto/history-query.dto';
import { HistoryDto } from '../dto/history.dto';
import { ChainReportCsvHistoryDto } from '../dto/output/chain-report-history.dto';
import { CoinTrackingCsvHistoryDto } from '../dto/output/coin-tracking-history.dto';
import { RefundDataDto } from '../dto/refund-data.dto';
import { TransactionFilter } from '../dto/transaction-filter.dto';
import { TransactionRefundDto } from '../dto/transaction-refund.dto';
import { TransactionDtoMapper } from '../mappers/transaction-dto.mapper';
import { ExportType, HistoryService } from '../services/history.service';

@ApiTags('Transaction')
@Controller('transaction')
export class TransactionController {
  private files: { [key: string]: StreamableFile } = {};
  private readonly refundList = new Map<number, RefundDataDto>();

  constructor(
    private readonly historyService: HistoryService,
    private readonly transactionService: TransactionService,
    private readonly buyCryptoWebhookService: BuyCryptoWebhookService,
    private readonly buyFiatService: BuyFiatService,
    private readonly refRewardService: RefRewardService,
    private readonly bankDataService: BankDataService,
    private readonly bankTxService: BankTxService,
    private readonly fiatService: FiatService,
    private readonly buyService: BuyService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly transactionUtilService: TransactionUtilService,
    private readonly userDataService: UserDataService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly bankService: BankService,
    private readonly transactionHelper: TransactionHelper,
    private readonly swissQrService: SwissQRService,
    private readonly sellService: SellService,
  ) {}

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_MINUTE)
  checkLists() {
    for (const [key, refundData] of this.refundList.entries()) {
      if (!this.isRefundDataValid(refundData)) this.refundList.delete(key);
    }
  }

  // --- OPEN ENDPOINTS --- //
  @Get()
  @ApiOkResponse({ type: TransactionDto, isArray: true })
  async getTransactions(
    @Query() query: HistoryQueryUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransactionDto[] | StreamableFile> {
    if (!query.format) query.format = ExportFormat.JSON;
    return this.getHistoryData(query, ExportType.COMPACT, res);
  }

  @Get('single')
  @ApiOkResponse({ type: TransactionDto })
  @ApiQuery({ name: 'uid', description: 'Transaction unique ID', required: false })
  @ApiQuery({ name: 'order-uid', description: 'Order unique ID', required: false })
  @ApiQuery({ name: 'cko-id', description: 'CKO ID', required: false })
  async getSingleTransaction(
    @Query('uid') uid?: string,
    @Query('order-uid') orderUid?: string,
    @Query('cko-id') ckoId?: string,
  ): Promise<TransactionDto | UnassignedTransactionDto> {
    const transaction = await this.getTransaction({ uid, orderUid, ckoId });

    const dto = await this.txToTransactionDto(transaction);
    if (!dto) throw new NotFoundException('Transaction not found');

    return dto;
  }

  @Put('csv')
  @ApiCreatedResponse()
  @ApiOperation({ description: 'Initiate CSV history export' })
  async createCsv(@Query() query: HistoryQueryUser): Promise<string> {
    const csvFile = await this.historyService.getCsvHistory({ ...query, format: ExportFormat.CSV }, ExportType.COMPACT);

    return this.cacheCsv(csvFile);
  }

  @Get('csv')
  @ApiOkResponse({ type: StreamableFile })
  @ApiOperation({ description: 'Get initiated CSV history export' })
  async getCsv(@Query('key') key: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const csvFile = this.files[key];
    if (!csvFile) throw new NotFoundException('File not found');
    delete this.files[key];

    this.setCsvResult(res, ExportType.COMPACT);

    return csvFile;
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
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: TransactionDetailDto, isArray: true })
  async getTransactionDetails(
    @GetJwt() jwt: JwtPayload,
    @Query() query: TransactionFilter,
  ): Promise<TransactionDetailDto[]> {
    return this.getAllTransactionsDetailed(jwt.account, query);
  }

  @Get('detail/single')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiOkResponse({ type: TransactionDetailDto })
  @ApiQuery({ name: 'id', description: 'Transaction ID', required: false })
  @ApiQuery({ name: 'uid', description: 'Transaction unique ID', required: false })
  @ApiQuery({ name: 'order-id', description: 'Order ID', required: false })
  @ApiQuery({ name: 'order-uid', description: 'Order unique ID', required: false })
  @ApiQuery({ name: 'external-id', description: 'External transaction ID', required: false })
  async getSingleTransactionDetails(
    @GetJwt() jwt: JwtPayload,
    @Query('id') id?: string,
    @Query('uid') uid?: string,
    @Query('order-id') orderId?: string,
    @Query('order-uid') orderUid?: string,
    @Query('external-id') externalId?: string,
  ): Promise<TransactionDto | UnassignedTransactionDto> {
    const transaction = await this.getTransaction({ id, uid, orderId, orderUid, externalId }, jwt.account);

    if (transaction && transaction.userData.id !== jwt.account) throw new ForbiddenException('Not your transaction');

    const dto = await this.txToTransactionDto(transaction, true);
    if (!dto) throw new NotFoundException('Transaction not found');

    return dto;
  }

  @Put('detail/csv')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiCreatedResponse()
  @ApiOperation({ description: 'Initiate CSV history export' })
  async createDetailCsv(@GetJwt() jwt: JwtPayload, @Query() query: TransactionFilter): Promise<string> {
    const transactions = await this.getAllTransactionsDetailed(jwt.account, query);

    const csvFile = this.historyService.getCsv(transactions, ExportType.COMPACT);

    return this.cacheCsv(csvFile);
  }

  @Get('unassigned')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  @ApiExcludeEndpoint()
  async getUnassignedTransactions(@GetJwt() jwt: JwtPayload): Promise<UnassignedTransactionDto[]> {
    const bankDatas = await this.bankDataService.getValidBankDatasForUser(jwt.account, false);

    const txList = await this.bankTxService.getUnassignedBankTx(bankDatas.map((b) => b.iban));
    return Util.asyncMap(txList, async (tx) => {
      const currency = await this.fiatService.getFiatByName(tx.txCurrency);
      return TransactionDtoMapper.mapUnassignedTransaction(tx, currency);
    });
  }

  @Get('target')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT), UserActiveGuard)
  @ApiExcludeEndpoint()
  async getTransactionTargets(@GetJwt() jwt: JwtPayload): Promise<TransactionTarget[]> {
    const buys = await this.buyService.getUserDataBuys(jwt.account);

    return buys.map((b) => ({
      id: b.id,
      address: b.user.address,
      asset: AssetDtoMapper.toDto(b.asset),
      bankUsage: b.bankUsage,
    }));
  }

  @Put(':id/target')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT), UserActiveGuard)
  @ApiExcludeEndpoint()
  async setTransactionTarget(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Query('buyId') buyId: string,
  ): Promise<void> {
    const transaction = await this.transactionService.getTransactionById(+id, { bankTx: true });
    if (!transaction.bankTx) throw new NotFoundException('Transaction not found');
    if (!BankTxTypeUnassigned(transaction.bankTx.type)) throw new ConflictException('Transaction already assigned');

    const buy = await this.buyService.get(jwt.account, +buyId);
    if (!buy) throw new NotFoundException('Buy not found');

    const bankDatas = await this.bankDataService.getValidBankDatasForUser(jwt.account, false);
    if (!bankDatas.map((b) => b.iban).includes(transaction.bankTx.senderAccount))
      throw new ForbiddenException('You can only assign your own transaction');

    await this.bankTxService.update(transaction.bankTx.id, { type: BankTxType.BUY_CRYPTO, buyId: buy.id });
  }

  @Get(':id/refund')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  async getTransactionRefund(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<RefundDataDto> {
    const transaction = await this.transactionService.getTransactionById(+id, {
      bankTx: { bankTxReturn: true },
      cryptoInput: true,
      checkoutTx: true,
      bankTxReturn: true,
      userData: true,
      buyCrypto: { cryptoInput: true, bankTx: true, checkoutTx: true },
      buyFiat: { cryptoInput: true },
      refReward: true,
    });

    if (!transaction || !transaction.refundTargetEntity) throw new NotFoundException('Transaction not found');

    let userData: UserData;

    // Unassigned transaction
    if (transaction.refundTargetEntity instanceof BankTx) {
      if (!BankTxTypeUnassigned(transaction.bankTx.type)) throw new NotFoundException('Transaction not found');
      const bankData = await this.bankDataService
        .getValidBankDatasForUser(jwt.account)
        .then((b) => b.find((b) => b.iban === transaction.bankTx.senderAccount));
      if (!bankData) throw new ForbiddenException('You can only refund your own transaction');
      if (transaction.refundTargetEntity.bankTxReturn)
        throw new BadRequestException('You can only refund a transaction once');

      userData = await this.userDataService.getUserData(jwt.account);
      await this.transactionService.updateInternal(transaction, { userData });
    } else {
      // Assigned transaction
      if (jwt.account !== transaction.userData.id)
        throw new ForbiddenException('You can only refund your own transaction');
      if (![CheckStatus.FAIL, CheckStatus.PENDING].includes(transaction.refundTargetEntity.amlCheck))
        throw new BadRequestException('You can only refund failed or pending transactions');
      if (transaction.refundTargetEntity.chargebackAmount)
        throw new BadRequestException('You can only refund a transaction once');
      if (transaction.refundTargetEntity.cryptoInput?.txType === PayInType.PAYMENT)
        throw new BadRequestException('You cannot refund payment transactions');

      userData = transaction.userData;
    }

    const bankIn = transaction.cryptoInput
      ? undefined
      : transaction.checkoutTx
      ? CardBankName.CHECKOUT
      : await this.bankService.getBankByIban(transaction.bankTx.accountIban).then((b) => b?.name);

    const refundTarget = await this.getRefundTarget(transaction);

    const refundData = await this.transactionHelper.getRefundData(
      transaction.refundTargetEntity,
      userData,
      bankIn,
      refundTarget,
      !transaction.cryptoInput,
    );

    this.refundList.set(transaction.id, refundData);

    return refundData;
  }

  @Put(':id/refund')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT))
  async setTransactionRefundTarget(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Body() dto: TransactionRefundDto,
  ): Promise<void> {
    const transaction = await this.transactionService.getTransactionById(+id, {
      bankTx: { transaction: { userData: true } },
      bankTxReturn: { bankTx: true },
      userData: true,
      buyCrypto: { cryptoInput: true, bankTx: true, checkoutTx: true, transaction: { userData: true } },
      buyFiat: { cryptoInput: true, transaction: { userData: true } },
      refReward: true,
    });

    if (!transaction || transaction.targetEntity instanceof RefReward)
      throw new NotFoundException('Transaction not found');
    if (transaction.targetEntity && jwt.account !== transaction.userData.id)
      throw new ForbiddenException('You can only refund your own transaction');
    if (!transaction.targetEntity) {
      const bankDatas = await this.bankDataService.getValidBankDatasForUser(jwt.account);
      if (!bankDatas.map((b) => b.iban).includes(transaction.bankTx.senderAccount))
        throw new ForbiddenException('You can only refund your own transaction');
    }

    const refundData = this.refundList.get(transaction.id);
    if (!refundData) throw new BadRequestException('Request refund data first');
    if (!this.isRefundDataValid(refundData)) throw new BadRequestException('Refund data request invalid');
    this.refundList.delete(transaction.id);

    const refundDto = { chargebackAmount: refundData.refundAmount, chargebackAllowedDateUser: new Date() };

    if (!transaction.targetEntity) {
      transaction.bankTxReturn = await this.bankTxService
        .updateInternal(transaction.bankTx, { type: BankTxType.BANK_TX_RETURN })
        .then((b) => b.bankTxReturn);
    }

    if (transaction.targetEntity instanceof BankTxReturn) {
      return this.bankTxReturnService.refundBankTx(transaction.targetEntity, {
        refundIban: refundData.refundTarget ?? dto.refundTarget,
        ...refundDto,
      });
    }

    if (transaction.targetEntity instanceof BuyFiat)
      return this.buyFiatService.refundBuyFiatInternal(transaction.targetEntity, {
        refundUserAddress: dto.refundTarget,
        ...refundDto,
      });

    if (transaction.targetEntity.cryptoInput)
      return this.buyCryptoService.refundCryptoInput(transaction.targetEntity, {
        refundUserAddress: dto.refundTarget,
        ...refundDto,
      });

    if (transaction.targetEntity.checkoutTx)
      return this.buyCryptoService.refundCheckoutTx(transaction.targetEntity, { ...refundDto });

    return this.buyCryptoService.refundBankTx(transaction.targetEntity, {
      refundIban: refundData.refundTarget ?? dto.refundTarget,
      ...refundDto,
    });
  }

  @Put(':id/invoice')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER), IpGuard, UserActiveGuard)
  @ApiOkResponse({ type: InvoiceDto })
  async generateInvoiceFromTransaction(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<InvoiceDto> {
    const transaction = await this.transactionService.getTransactionById(+id, {
      userData: true,
      user: { userData: true }, // TODO: remove, use userData instead
      buyCrypto: { outputAsset: true, buy: true, cryptoRoute: true, cryptoInput: { asset: true } },
      buyFiat: { outputAsset: true, sell: true, cryptoInput: { asset: true } },
      refReward: { user: { userData: true } },
    });

    // TODO: remove, only for local testing
    transaction.userData = transaction.user.userData;

    if (!transaction) throw new BadRequestException('Transaction not found');
    if (!transaction.userData.isDataComplete) throw new BadRequestException('User data is not complete');
    if (transaction.amlCheck && transaction.amlCheck !== CheckStatus.PASS)
      throw new BadRequestException('AML check not passed');
    if (transaction.userData.id !== jwt.account) throw new ForbiddenException('Not your transaction');

    const { transactionType, currency, bankInfo } = await this.getInvoiceDetails(transaction);

    return {
      invoicePdf: await this.swissQrService.createInvoiceFromTx(transactionType, transaction, currency, bankInfo),
    };
  }

  private async getInvoiceDetails(
    transaction: Transaction,
  ): Promise<{ transactionType: TransactionType; currency: 'CHF' | 'EUR'; bankInfo?: BankInfoDto }> {
    let transactionType: TransactionType;
    let currency: Fiat;
    let bankInfo: BankInfoDto | undefined;

    if (transaction.buyCrypto && !transaction.buyCrypto.isCryptoCryptoTransaction) {
      const buy = transaction.buyCrypto.buy;
      if (!buy) throw new BadRequestException('Buy route not found');

      transactionType = TransactionType.BUY;
      currency = await this.fiatService.getFiatByName(transaction.buyCrypto.inputAsset);
      bankInfo = await this.buyService.getBankInfo({
        amount: transaction.buyCrypto.inputAmount,
        currency: currency.name,
        paymentMethod: transaction.buyCrypto.paymentMethodIn,
        userData: transaction.userData,
      });
    } else if (transaction.buyFiat) {
      const sell = transaction.buyFiat.sell;
      if (!sell) throw new BadRequestException('Sell route not found');

      transactionType = TransactionType.SELL;
      currency = transaction.buyFiat.outputAsset;
      bankInfo = await this.sellService.getBankInfo({
        amount: transaction.buyFiat.outputAmount,
        currency: currency.name,
        paymentMethod: transaction.buyFiat.paymentMethodOut,
        userData: transaction.userData,
      });
    } else if (transaction.buyCrypto && transaction.buyCrypto.isCryptoCryptoTransaction) {
      const swap = transaction.buyCrypto.cryptoRoute;
      if (!swap) throw new BadRequestException('Swap route not found');

      transactionType = TransactionType.SWAP;
      currency = await this.getPreferredInvoiceCurrency(transaction.userData);
    } else if (transaction.refReward) {
      const targetBlockchain = transaction.refReward.targetBlockchain;
      if (!targetBlockchain) throw new BadRequestException('Missing blockchain information');

      transactionType = TransactionType.REFERRAL;
      currency = await this.getPreferredInvoiceCurrency(transaction.userData);
    } else {
      throw new BadRequestException('Transaction type not supported for invoice generation');
    }

    if (currency.name !== 'CHF' && currency.name !== 'EUR') {
      throw new BadRequestException('Only CHF and EUR are supported for invoice generation');
    }

    return {
      transactionType,
      currency: currency.name,
      bankInfo,
    };
  }

  private async getPreferredInvoiceCurrency(userData: UserData): Promise<Fiat> {
    const preferredCurrency = userData.currency.name;
    const allowedCurrency = ['CHF', 'EUR'].includes(preferredCurrency) ? preferredCurrency : 'CHF';
    const currency = await this.fiatService.getFiatByName(allowedCurrency);
    if (!currency) throw new BadRequestException('Preferred currency not found');

    return currency;
  }

  // --- HELPER METHODS --- //

  private async getRefundTarget(transaction: Transaction): Promise<string | undefined> {
    if (transaction.refundTargetEntity instanceof BuyFiat) return transaction.refundTargetEntity.chargebackAddress;

    try {
      if (transaction.bankTx && (await this.validateIban(transaction.bankTx.iban))) return transaction.bankTx.iban;
    } catch (_) {
      return transaction.refundTargetEntity instanceof BankTx
        ? undefined
        : transaction.refundTargetEntity?.chargebackIban;
    }

    if (transaction.refundTargetEntity instanceof BuyCrypto)
      return transaction.refundTargetEntity.checkoutTx
        ? `${transaction.refundTargetEntity.checkoutTx.cardBin}****${transaction.refundTargetEntity.checkoutTx.cardLast4}`
        : transaction.refundTargetEntity.chargebackIban;
  }

  private async validateIban(iban: string): Promise<boolean> {
    if (!iban) return false;

    return (
      IbanTools.validateIBAN(iban).valid && (await this.transactionUtilService.validateChargebackIban(iban, false))
    );
  }

  private isRefundDataValid(refundData: RefundDataDto): boolean {
    return Util.secondsDiff(refundData.expiryDate) <= 0;
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

  private formatDate(date: Date = new Date()): string {
    return Util.isoDateTime(date).split('-').join('');
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

  private async getAllTransactionsDetailed(
    userDataId: number,
    query: TransactionFilter,
  ): Promise<TransactionDetailDto[] | UnassignedTransactionDto[]> {
    const txList = await this.transactionService.getTransactionsForAccount(userDataId, query.from, query.to);

    // map to DTO
    return Util.asyncMap(txList, async (tx) => {
      if (!tx.targetEntity) return undefined;
      return this.txToTransactionDto(tx, true);
    }).then((list) => list.filter((dto) => dto));
  }

  private async getTransaction(
    {
      id,
      uid,
      orderId,
      orderUid,
      externalId,
      ckoId,
    }: {
      id?: string;
      uid?: string;
      orderId?: string;
      orderUid?: string;
      externalId?: string;
      ckoId?: string;
    },
    accountId?: number,
  ): Promise<Transaction | undefined> {
    const relations: FindOptionsRelations<Transaction> = {
      buyCrypto: { buy: true, cryptoRoute: true, cryptoInput: true, bankTx: true, chargebackOutput: true },
      buyFiat: { sell: true, cryptoInput: true, bankTx: true, fiatOutput: true },
      refReward: true,
      bankTx: { transaction: true },
      cryptoInput: true,
      checkoutTx: true,
      userData: true,
      user: { userData: true },
      request: true,
    };

    let transaction: Transaction;
    if (id) transaction = await this.transactionService.getTransactionById(+id, relations);
    if (uid) transaction = await this.transactionService.getTransactionByUid(uid, relations);
    if (orderId) transaction = await this.transactionService.getTransactionByRequestId(+orderId, relations);
    if (orderUid) transaction = await this.transactionService.getTransactionByRequestUid(orderUid, relations);
    if (externalId && accountId)
      transaction = await this.transactionService.getTransactionByExternalId(externalId, accountId, relations);
    if (ckoId) transaction = await this.transactionService.getTransactionByCkoId(ckoId, relations);

    return transaction;
  }

  private async txToTransactionDto(
    transaction?: Transaction,
    detailed = false,
  ): Promise<TransactionDto | TransactionDetailDto | UnassignedTransactionDto | undefined> {
    switch (transaction?.targetEntity?.constructor) {
      case BuyCrypto:
        const buyCryptoExtended = await this.buyCryptoWebhookService.extendBuyCrypto(transaction.buyCrypto);
        return detailed
          ? TransactionDtoMapper.mapBuyCryptoTransactionDetail(buyCryptoExtended)
          : TransactionDtoMapper.mapBuyCryptoTransaction(buyCryptoExtended);

      case BuyFiat:
        const buyFiatExtended = await this.buyFiatService.extendBuyFiat(transaction.buyFiat);
        return detailed
          ? TransactionDtoMapper.mapBuyFiatTransactionDetail(buyFiatExtended)
          : TransactionDtoMapper.mapBuyFiatTransaction(buyFiatExtended);

      case RefReward:
        const refRewardExtended = await this.refRewardService.extendReward(transaction.refReward);
        return detailed
          ? TransactionDtoMapper.mapReferralRewardDetail(refRewardExtended)
          : TransactionDtoMapper.mapReferralReward(refRewardExtended);

      default:
        if (transaction?.sourceEntity instanceof BankTx && !transaction?.type) {
          const currency = await this.fiatService.getFiatByName(transaction.bankTx.txCurrency);
          return TransactionDtoMapper.mapUnassignedTransaction(transaction.bankTx, currency);
        }

        return undefined;
    }
  }
}
