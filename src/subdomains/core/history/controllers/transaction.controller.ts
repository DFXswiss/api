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
import { Config } from 'src/config/config';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxCron } from 'src/shared/utils/cron';
import { AmountType, Util } from 'src/shared/utils/util';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTxReturnService } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service';
import {
  BankTx,
  BankTxType,
  BankTxTypeUnassigned,
} from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { FindOptionsRelations } from 'typeorm';
import {
  TransactionDetailDto,
  TransactionDto,
  TransactionTarget,
  UnassignedTransactionDto,
} from '../../../supporting/payment/dto/transaction.dto';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoWebhookService } from '../../buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyCryptoService } from '../../buy-crypto/process/services/buy-crypto.service';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { RefRewardService } from '../../referral/reward/services/ref-reward.service';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from '../../sell-crypto/process/services/buy-fiat.service';
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
    private readonly feeService: FeeService,
    private readonly transactionUtilService: TransactionUtilService,
    private readonly userDataService: UserDataService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly specialExternalAccountService: SpecialExternalAccountService,
    private readonly transactionRequestService: TransactionRequestService,
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
    const tx = await this.getTransaction({ uid, orderUid, ckoId });

    const dto =
      tx instanceof Transaction ? await this.txToTransactionDto(tx) : await this.waitingTxRequestToTransactionDto(tx);
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
  @ApiQuery({ name: 'order-id', description: 'Transaction order ID', required: false })
  @ApiQuery({ name: 'external-id', description: 'External transaction ID', required: false })
  @ApiQuery({ name: 'order-uid', description: 'Order unique ID', required: false })
  async getSingleTransactionDetails(
    @GetJwt() jwt: JwtPayload,
    @Query('id') id?: string,
    @Query('uid') uid?: string,
    @Query('order-id') orderId?: string,
    @Query('external-id') externalId?: string,
    @Query('order-uid') orderUid?: string,
  ): Promise<TransactionDto | UnassignedTransactionDto> {
    const tx = await this.getTransaction({ id, uid, orderId, orderUid, externalId });

    if (tx && tx.userData.id !== jwt.account) throw new ForbiddenException('Not your transaction');

    const dto =
      tx instanceof Transaction
        ? await this.txToTransactionDto(tx, true)
        : await this.waitingTxRequestToTransactionDto(tx, true);
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
      bankTx: true,
      bankTxReturn: true,
      user: { userData: true },
      checkoutTx: true,
      buyCrypto: { cryptoInput: { route: { user: true } }, bankTx: true, checkoutTx: true },
      buyFiat: { cryptoInput: { route: { user: true } } },
    });

    if (!transaction || transaction.targetEntity instanceof RefReward)
      throw new NotFoundException('Transaction not found');

    let refundData: RefundDataDto;

    // Unassigned transaction
    if (
      !(transaction.targetEntity instanceof BuyFiat) &&
      (transaction.targetEntity instanceof BankTxReturn || !transaction.targetEntity)
    ) {
      if (!transaction.bankTx || !BankTxTypeUnassigned(transaction.bankTx.type))
        throw new NotFoundException('Transaction not found');

      const bankDatas = await this.bankDataService.getValidBankDatasForUser(jwt.account);
      if (!bankDatas.map((b) => b.iban).includes(transaction.bankTx.senderAccount))
        throw new ForbiddenException('You can only refund your own transaction');

      if (transaction.targetEntity?.chargebackAmount)
        throw new BadRequestException('You can only refund a transaction once');

      const bankFeeAmount = transaction.bankTx.chargeAmount;

      const inputAmount = transaction.bankTx.amount + transaction.bankTx.chargeAmount;

      if (bankFeeAmount >= inputAmount) throw new BadRequestException('Transaction fee is too expensive');

      const refundAsset = FiatDtoMapper.toDto(await this.fiatService.getFiatByName(transaction.bankTx.currency));

      const refundTarget = (await this.validateIban(transaction.bankTx?.iban))
        ? transaction.bankTx.iban
        : transaction.targetEntity?.chargebackIban;

      refundData = {
        expiryDate: Util.secondsAfter(Config.transactionRefundExpirySeconds),
        inputAmount,
        inputAsset: refundAsset,
        refundAmount: Util.roundReadable(inputAmount - bankFeeAmount, AmountType.FIAT),
        fee: {
          network: 0,
          bank: Util.roundReadable(bankFeeAmount, AmountType.FIAT_FEE),
        },
        refundAsset,
        refundTarget,
      };
    } else {
      // Assigned transaction
      if (jwt.account !== transaction.userData.id)
        throw new ForbiddenException('You can only refund your own transaction');
      if (![CheckStatus.FAIL, CheckStatus.PENDING].includes(transaction.targetEntity.amlCheck))
        throw new BadRequestException('You can only refund failed or pending transactions');
      if (transaction.targetEntity.chargebackAmount)
        throw new BadRequestException('You can only refund a transaction once');
      if (transaction.targetEntity?.cryptoInput?.txType === PayInType.PAYMENT)
        throw new BadRequestException('You cannot refund payment transactions');

      const amountType = transaction.targetEntity.cryptoInput ? AmountType.ASSET : AmountType.FIAT;
      const feeAmountType = transaction.targetEntity.cryptoInput ? AmountType.ASSET_FEE : AmountType.FIAT_FEE;

      const inputAmount = Util.roundReadable(
        transaction.bankTx
          ? transaction.bankTx.amount + transaction.bankTx.chargeAmount
          : transaction.targetEntity.inputAmount,
        amountType,
      );

      const networkFeeAmount = transaction.targetEntity.cryptoInput
        ? await this.feeService.getBlockchainFee(transaction.targetEntity.cryptoInput.asset, false)
        : 0;

      const bankFeeAmount =
        transaction.targetEntity.cryptoInput || transaction.checkoutTx ? 0 : inputAmount - transaction.bankTx.amount;

      const totalFeeAmount = Util.roundReadable(networkFeeAmount + bankFeeAmount, feeAmountType);

      if (totalFeeAmount >= inputAmount) throw new BadRequestException('Transaction fee is too expensive');

      const refundAsset = transaction.targetEntity.cryptoInput?.asset
        ? AssetDtoMapper.toDto(transaction.targetEntity.cryptoInput?.asset)
        : FiatDtoMapper.toDto(await this.fiatService.getFiatByName(transaction.targetEntity.inputReferenceAsset));

      let refundTarget = null;

      if (transaction.targetEntity instanceof BuyCrypto) {
        try {
          refundTarget = transaction.targetEntity.checkoutTx
            ? `${transaction.targetEntity.checkoutTx.cardBin}****${transaction.targetEntity.checkoutTx.cardLast4}`
            : (await this.validateIban(transaction.targetEntity.bankTx?.iban))
            ? transaction.targetEntity.bankTx.iban
            : transaction.targetEntity.chargebackIban;
        } catch (_) {
          refundTarget = transaction.targetEntity.chargebackIban;
        }
      } else {
        refundTarget = transaction.targetEntity.chargebackAddress;
      }

      refundData = {
        expiryDate: Util.secondsAfter(Config.transactionRefundExpirySeconds),
        inputAmount: Util.roundReadable(inputAmount, amountType),
        inputAsset: refundAsset,
        refundAmount: inputAmount - totalFeeAmount,
        fee: {
          network: Util.roundReadable(networkFeeAmount, feeAmountType),
          bank: Util.roundReadable(bankFeeAmount, feeAmountType),
        },
        refundAsset,
        refundTarget,
      };
    }

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
      bankTx: { transaction: true },
      bankTxReturn: true,
      user: { userData: true },
      buyCrypto: {
        transaction: { user: { userData: true } },
        cryptoInput: { route: { user: true } },
        bankTx: true,
        checkoutTx: true,
      },
      buyFiat: { transaction: { user: { userData: true } }, cryptoInput: { route: { user: true } } },
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
      const userData = await this.userDataService.getUserData(jwt.account);
      transaction.bankTxReturn = await this.bankTxService
        .updateInternal(transaction.bankTx, { type: BankTxType.BANK_TX_RETURN }, userData)
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

  // --- HELPER METHODS --- //

  private async validateIban(iban: string): Promise<boolean> {
    if (!iban) return false;

    const multiAccountIbans = await this.specialExternalAccountService.getMultiAccountIbans();
    return (
      IbanTools.validateIBAN(iban).valid &&
      !multiAccountIbans.includes(iban) &&
      (await this.transactionUtilService.validateChargebackIban(iban))
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
    const waitingTxRequestList = await this.transactionRequestService.getWaitingTransactionRequest(
      userDataId,
      query.from,
      query.to,
    );

    // map to DTO
    return [
      ...(await Util.asyncMap(txList, async (tx) => {
        if (!tx.targetEntity) return undefined;
        return this.txToTransactionDto(tx, true);
      }).then((list) => list.filter((dto) => dto))),
      ...(await Util.asyncMap(waitingTxRequestList, async (txRequest) => {
        return this.waitingTxRequestToTransactionDto(txRequest, true);
      }).then((list) => list.filter((dto) => dto))),
    ];
  }

  private async getTransaction(
    {
      id,
      uid,
      orderUid,
      orderId,
      externalId,
      ckoId,
    }: {
      id?: string;
      uid?: string;
      orderUid?: string;
      orderId?: string;
      externalId?: string;
      ckoId?: string;
    },
    accountId?: number,
  ): Promise<Transaction | TransactionRequest | undefined> {
    const relations: FindOptionsRelations<Transaction> = {
      buyCrypto: { buy: { user: true }, cryptoRoute: { user: true }, cryptoInput: true, bankTx: true },
      buyFiat: { sell: { user: true }, cryptoInput: true, bankTx: true, fiatOutput: true },
      refReward: true,
      bankTx: { transaction: true },
      cryptoInput: true,
      checkoutTx: true,
      user: { userData: true },
      request: true,
    };

    let tx: Transaction | TransactionRequest;
    if (id) tx = await this.transactionService.getTransactionById(+id, relations);
    if (uid)
      tx =
        (await this.transactionService.getTransactionByUid(uid, relations)) ??
        (await this.transactionRequestService.getTransactionRequestByUid(uid, { user: { userData: true } }));
    if (orderUid) tx = await this.transactionService.getTransactionByRequestUid(orderUid, relations);
    if (orderId)
      tx =
        (await this.transactionService.getTransactionByRequestId(+orderId, relations)) ??
        (await this.transactionRequestService.getTransactionRequest(+orderId, { user: { userData: true } }));
    if (externalId && accountId)
      tx = await this.transactionService.getTransactionByExternalId(externalId, accountId, relations);
    if (ckoId) tx = await this.transactionService.getTransactionByCkoId(ckoId, relations);

    return tx;
  }

  private async waitingTxRequestToTransactionDto(
    txRequest?: TransactionRequest,
    detailed = false,
  ): Promise<TransactionDto | TransactionDetailDto | undefined> {
    const txRequestExtended = await this.transactionRequestService.extendTransactionRequest(txRequest);
    return detailed
      ? TransactionDtoMapper.mapTxRequestTransactionDetail(txRequestExtended)
      : TransactionDtoMapper.mapTxRequestTransaction(txRequestExtended);
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
