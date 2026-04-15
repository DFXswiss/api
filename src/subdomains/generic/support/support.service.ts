import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { isIP } from 'class-validator';
import * as IbanTools from 'ibantools';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { AmountType, Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { NotRefundableAmlReasons } from 'src/subdomains/core/aml/enums/aml-reason.enum';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { RefundDataDto } from 'src/subdomains/core/history/dto/refund-data.dto';
import { BankRefundDto, TransactionRefundDto } from 'src/subdomains/core/history/dto/transaction-refund.dto';
import { CardBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { BankTxReturnService } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service';
import {
  BankTx,
  BankTxType,
  BankTxTypeUnassigned,
} from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { IpLog } from 'src/shared/models/ip-log/ip-log.entity';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { KycLog } from '../kyc/entities/kyc-log.entity';
import { KycStep } from '../kyc/entities/kyc-step.entity';
import { KycStepName } from '../kyc/enums/kyc-step-name.enum';
import { ReviewStatus } from '../kyc/enums/review-status.enum';
import { FileSubType, FileType } from '../kyc/dto/kyc-file.dto';
import { ContentType } from '../kyc/enums/content-type.enum';
import { SupportPdfService } from './support-pdf.service';
import { KycDocumentService } from '../kyc/services/integration/kyc-document.service';
import { KycFileService } from '../kyc/services/kyc-file.service';
import { KycLogService } from '../kyc/services/kyc-log.service';
import { KycService } from '../kyc/services/kyc.service';
import { BankData } from '../user/models/bank-data/bank-data.entity';
import { BankDataService } from '../user/models/bank-data/bank-data.service';
import { Recommendation } from '../user/models/recommendation/recommendation.entity';
import { RecommendationService } from '../user/models/recommendation/recommendation.service';
import { AccountType } from '../user/models/user-data/account-type.enum';
import { UserData } from '../user/models/user-data/user-data.entity';
import { UserDataService } from '../user/models/user-data/user-data.service';
import { User } from '../user/models/user/user.entity';
import { UserService } from '../user/models/user/user.service';
import { ComplianceDecision, GenerateOnboardingPdfDto } from './dto/onboarding-pdf.dto';
import { TransactionListQuery } from './dto/transaction-list-query.dto';
import {
  BankDataSupportInfo,
  BankTxSupportInfo,
  BuySupportInfo,
  CryptoInputSupportInfo,
  IpLogSupportInfo,
  SupportIssueSupportInfo,
  ComplianceSearchType,
  KycFileListEntry,
  KycFileYearlyStats,
  KycLogSupportInfo,
  KycStepSupportInfo,
  RecommendationEntry,
  RecommendationGraph,
  RecommendationGraphEdge,
  RecommendationGraphNode,
  RecommendationUserInfo,
  SellSupportInfo,
  TransactionListEntry,
  TransactionSupportInfo,
  OnboardingStatus,
  PendingOnboardingInfo,
  UserDataSupportInfo,
  UserDataSupportInfoDetails,
  UserDataSupportInfoResult,
  UserDataSupportQuery,
  UserSupportInfo,
} from './dto/user-data-support.dto';

interface UserDataComplianceSearchTypePair {
  type: ComplianceSearchType;
  userData: UserData;
}

@Injectable()
export class SupportService {
  private readonly refundList = new Map<number, RefundDataDto>();

  constructor(
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly swapService: SwapService,
    private readonly buyCryptoService: BuyCryptoService,
    private readonly buyFiatService: BuyFiatService,
    private readonly bankTxService: BankTxService,
    private readonly payInService: PayInService,
    private readonly kycFileService: KycFileService,
    private readonly kycLogService: KycLogService,
    private readonly kycService: KycService,
    private readonly bankDataService: BankDataService,
    private readonly bankTxReturnService: BankTxReturnService,
    private readonly transactionService: TransactionService,
    private readonly virtualIbanService: VirtualIbanService,
    private readonly bankService: BankService,
    @Inject(forwardRef(() => TransactionHelper))
    private readonly transactionHelper: TransactionHelper,
    private readonly settingService: SettingService,
    private readonly recommendationService: RecommendationService,
    private readonly ipLogService: IpLogService,
    private readonly supportIssueService: SupportIssueService,
    private readonly kycDocumentService: KycDocumentService,
    private readonly supportPdfService: SupportPdfService,
  ) {}

  async generateIpLogPdf(userDataId: number): Promise<string> {
    const ipLogs = await this.ipLogService.getByUserDataId(userDataId);
    return this.supportPdfService.generateIpLogPdf(userDataId, ipLogs);
  }

  async generateTransactionPdf(userDataId: number): Promise<string> {
    const transactions = await this.transactionService.getTransactionsByUserDataId(userDataId);
    return this.supportPdfService.generateTransactionPdf(userDataId, transactions, (tx) =>
      this.toTransactionSupportInfo(tx),
    );
  }

  async generateAndSaveOnboardingPdf(
    userDataId: number,
    dto: GenerateOnboardingPdfDto,
  ): Promise<{ pdfData: string; fileName: string }> {
    // Load UserData with relations
    const userData = await this.userDataService.getUserData(userDataId, {
      users: true,
      country: true,
      nationality: true,
      language: true,
      organization: true,
    });
    if (!userData) throw new NotFoundException('User not found');

    // Load KycFiles and KycSteps
    const [kycFiles, kycSteps] = await Promise.all([
      this.kycFileService.getUserDataKycFiles(userDataId),
      this.kycService.getStepsByUserData(userDataId),
    ]);

    // Generate PDF
    const pdfData = await this.supportPdfService.createOnboardingPdf(userData, kycFiles, kycSteps, dto);

    // Save as KycFile
    const fileName = `GwG_Onboarding_${userDataId}_${Date.now()}.pdf`;
    await this.kycDocumentService.uploadUserFile(
      userData,
      FileType.USER_NOTES,
      fileName,
      Buffer.from(pdfData, 'base64'),
      ContentType.PDF,
      true, // isProtected
      undefined, // kycStep
      FileSubType.ONBOARDING_REPORT,
    );

    return { pdfData, fileName };
  }

  async getUserDataDetails(id: number): Promise<UserDataSupportInfoDetails> {
    const userData = await this.userDataService.getUserData(id, { wallet: true, bankDatas: true });
    if (!userData) throw new NotFoundException(`User not found`);

    // Load all related data in parallel
    const [kycFiles, kycSteps, kycLogs, transactions, users, bankDatas, buyRoutes, sellRoutes, ipLogs, supportIssues] =
      await Promise.all([
        this.kycFileService.getUserDataKycFiles(id),
        this.kycService.getStepsByUserData(id),
        this.kycLogService.getLogsByUserDataId(id),
        this.transactionService.getTransactionsByUserDataId(id),
        this.userService.getAllUserDataUsers(id),
        this.bankDataService.getBankDatasByUserData(id),
        this.buyService.getUserDataBuys(id),
        this.sellService.getSellsByUserDataId(id),
        this.ipLogService.getByUserDataId(id),
        this.supportIssueService.getIssueEntities(id),
      ]);

    // Load bank transactions for the loaded transactions (incoming + outgoing)
    const transactionIds = transactions.map((t) => t.id);
    const [incomingBankTxs, buyFiats, cryptoInputs] = await Promise.all([
      this.bankTxService.getBankTxsByTransactionIds(transactionIds),
      this.buyFiatService.getBuyFiatsByTransactionIds(transactionIds),
      this.payInService.getCryptoInputsByTransactionIds(transactionIds),
    ]);

    // Merge incoming BankTx (direct) and outgoing BankTx (via BuyFiat -> FiatOutput -> BankTx)
    const outgoingBankTxs = buyFiats
      .filter((bf) => bf.fiatOutput?.bankTx)
      .map((bf) => {
        const bankTx = bf.fiatOutput.bankTx;
        bankTx.transaction = bf.transaction;
        return bankTx;
      });
    const bankTxs = [...incomingBankTxs, ...outgoingBankTxs];

    // Load recommendation data for Recommendation steps
    const recommendationStepIds = kycSteps.filter((s) => s.name === KycStepName.RECOMMENDATION).map((s) => s.id);
    const recommendations = await this.recommendationService.getRecommendationsByKycStepIdsOrUserDataId(
      recommendationStepIds,
      id,
    );
    // Map by kycStepId first, then fall back to first recommendation for this userData
    const recommendationByStep = new Map(recommendations.filter((r) => r.kycStep?.id).map((r) => [r.kycStep.id, r]));
    const fallbackRecommendation = recommendations[0];

    // Load all recommendations by the recommender (to show the full network)
    const recommenderId = fallbackRecommendation?.recommender?.id;
    const allByRecommender = recommenderId
      ? await this.recommendationService.getAllRecommendationsByRecommenderId(recommenderId)
      : [];

    return {
      userData,
      kycFiles,
      kycSteps: kycSteps.map((s) =>
        this.toKycStepSupportInfo(
          s,
          s.name === KycStepName.RECOMMENDATION
            ? (recommendationByStep.get(s.id) ?? fallbackRecommendation)
            : undefined,
          s.name === KycStepName.RECOMMENDATION ? allByRecommender : undefined,
        ),
      ),
      kycLogs: kycLogs.map((l) => this.toKycLogSupportInfo(l)),
      transactions: transactions.map((t) => this.toTransactionSupportInfo(t)),
      bankTxs: bankTxs.map((b) => this.toBankTxDto(b)),
      cryptoInputs: cryptoInputs.map((c) => this.toCryptoInputSupportInfo(c)),
      ipLogs: ipLogs.map((l) => this.toIpLogSupportInfo(l)),
      supportIssues: supportIssues.map((s) => this.toSupportIssueSupportInfo(s)),
      users: users.map((u) => this.toUserSupportInfo(u)),
      bankDatas: bankDatas.map((b) => this.toBankDataSupportInfo(b)),
      buyRoutes: buyRoutes.map((b) => this.toBuySupportInfo(b)),
      sellRoutes: sellRoutes.map((s) => this.toSellSupportInfo(s)),
    };
  }

  async getKycFileList(): Promise<KycFileListEntry[]> {
    const [userData, auditPeriod] = await Promise.all([
      this.userDataService.getUserDatasWithKycFile(),
      this.settingService.getObj<{ start: string; end: string }>('AuditPeriod'),
    ]);
    const auditStartDate = auditPeriod?.start ? new Date(auditPeriod.start) : undefined;

    return userData.map((d) => this.toKycFileListEntry(d, auditStartDate));
  }

  async getKycFileStats(startYear = 2021, endYear = new Date().getFullYear()): Promise<KycFileYearlyStats[]> {
    const dbStats = await this.userDataService.getKycFileYearlyStats(startYear, endYear);
    const result: KycFileYearlyStats[] = [];

    let previousEndCount = 0;

    for (let year = startYear; year <= endYear; year++) {
      const yearStats = dbStats.get(year) ?? { reopened: 0, newFiles: 0, closedDuringYear: 0, highestFileNr: 0 };

      const startCount = previousEndCount;
      const addedDuringYear = yearStats.reopened + yearStats.newFiles;
      const activeDuringYear = startCount + addedDuringYear;
      const endCount = activeDuringYear - yearStats.closedDuringYear;

      result.push({
        year,
        startCount,
        reopened: yearStats.reopened,
        newFiles: yearStats.newFiles,
        addedDuringYear,
        activeDuringYear,
        closedDuringYear: yearStats.closedDuringYear,
        endCount,
        highestFileNr: yearStats.highestFileNr,
      });

      previousEndCount = endCount;
    }

    return result;
  }

  async getTransactionList(query: TransactionListQuery): Promise<TransactionListEntry[]> {
    const dateFrom = new Date(query.createdFrom ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());
    const dateTo = new Date(query.createdTo ?? new Date().toISOString());
    dateTo.setHours(23, 59, 59, 999);

    const outputFrom = query.outputFrom ? new Date(query.outputFrom) : undefined;
    const outputTo = query.outputTo ? new Date(query.outputTo) : undefined;
    if (outputTo) outputTo.setHours(23, 59, 59, 999);

    const transactions = await this.transactionService.getTransactionList(dateFrom, dateTo, outputFrom, outputTo);
    return transactions.map((t) => this.toTransactionListEntry(t));
  }

  // --- MAPPING METHODS --- //

  private toTransactionListEntry(tx: Transaction): TransactionListEntry {
    return {
      id: tx.id,
      type: tx.type,
      accountId: tx.userData?.id,
      kycFileId: tx.userData?.kycFileId,
      name: tx.userData?.verifiedName,
      domicile: tx.userData?.country?.name ?? tx.userData?.verifiedCountry?.name,
      created: tx.created,
      eventDate: tx.eventDate,
      outputDate: tx.outputDate,
      assets: tx.assets,
      amountInChf: tx.amountInChf,
      highRisk: tx.highRisk,
    };
  }

  private toKycFileListEntry(userData: UserData, auditStartDate?: Date): KycFileListEntry {
    return {
      kycFileId: userData.kycFileId,
      id: userData.id,
      amlAccountType: userData.amlAccountType,
      verifiedName: userData.verifiedName,
      country: userData.country ? { name: userData.country.name } : undefined,
      allBeneficialOwnersDomicile: userData.allBeneficialOwnersDomicile,
      amlListAddedDate: userData.amlListAddedDate,
      amlListExpiredDate: userData.amlListExpiredDate,
      amlListReactivatedDate: userData.amlListReactivatedDate,
      newOpeningInAuditPeriod:
        auditStartDate && userData.amlListAddedDate ? new Date(userData.amlListAddedDate) > auditStartDate : false,
      highRisk: userData.highRisk,
      pep: userData.pep,
      complexOrgStructure: userData.complexOrgStructure,
      totalVolumeChfAuditPeriod: userData.totalVolumeChfAuditPeriod,
      totalCustodyBalanceChfAuditPeriod: userData.totalCustodyBalanceChfAuditPeriod,
    };
  }

  private toKycStepSupportInfo(
    step: KycStep,
    recommendation?: Recommendation,
    allByRecommender?: Recommendation[],
  ): KycStepSupportInfo {
    const toUserInfo = (ud?: UserData): RecommendationUserInfo | undefined =>
      ud ? { id: ud.id, firstname: ud.firstname, surname: ud.surname } : undefined;

    const toEntry = (r: Recommendation): RecommendationEntry => ({
      id: r.id,
      recommended: toUserInfo(r.recommended) ?? { id: 0 },
      isConfirmed: r.isConfirmed,
      confirmationDate: r.confirmationDate,
      created: r.created,
    });

    return {
      id: step.id,
      name: step.name,
      type: step.type,
      status: step.status,
      sequenceNumber: step.sequenceNumber,
      result: step.result,
      comment: step.comment,
      recommender: toUserInfo(recommendation?.recommender),
      recommended: toUserInfo(recommendation?.recommended),
      allRecommendations: allByRecommender?.map(toEntry),
      created: step.created,
    };
  }

  private toKycLogSupportInfo(log: KycLog): KycLogSupportInfo {
    return {
      id: log.id,
      type: log.type,
      result: log.result,
      comment: log.comment,
      created: log.created,
    };
  }

  private toTransactionSupportInfo(tx: Transaction): TransactionSupportInfo {
    return {
      id: tx.id,
      uid: tx.uid,
      type: tx.type,
      sourceType: tx.sourceType,
      inputAmount: tx.buyCrypto?.inputAmount ?? tx.buyFiat?.inputAmount,
      inputAsset: tx.buyCrypto?.inputAsset ?? tx.buyFiat?.inputAsset,
      amountInChf: tx.amountInChf,
      amountInEur: tx.buyCrypto?.amountInEur ?? tx.buyFiat?.amountInEur,
      amlCheck: tx.amlCheck,
      chargebackDate:
        tx.buyCrypto?.chargebackDate ??
        tx.buyFiat?.chargebackDate ??
        tx.bankTxReturn?.chargebackDate ??
        tx.bankTxRepeat?.chargebackDate,
      amlReason: tx.buyCrypto?.amlReason ?? tx.buyFiat?.amlReason,
      isCompleted: !!tx.completionDate,
      created: tx.created,
    };
  }

  private toUserSupportInfo(user: User): UserSupportInfo {
    return {
      id: user.id,
      address: user.address,
      ref: user.ref,
      role: user.role,
      status: user.status,
      created: user.created,
    };
  }

  private toBankDataSupportInfo(bankData: BankData): BankDataSupportInfo {
    return {
      id: bankData.id,
      iban: bankData.iban,
      name: bankData.name,
      type: bankData.type,
      status: bankData.status,
      approved: bankData.approved,
      manualApproved: bankData.manualApproved,
      active: bankData.active,
      comment: bankData.comment,
      created: bankData.created,
    };
  }

  private toBuySupportInfo(buy: Buy): BuySupportInfo {
    return {
      id: buy.id,
      iban: buy.iban,
      bankUsage: buy.bankUsage,
      assetName: buy.asset?.name,
      blockchain: buy.asset?.blockchain,
      volume: buy.volume,
      active: buy.active,
      created: buy.created,
    };
  }

  private toSellSupportInfo(sell: Sell): SellSupportInfo {
    return {
      id: sell.id,
      iban: sell.iban,
      fiatName: sell.fiat?.name,
      volume: sell.annualVolume,
      active: sell.active,
      created: sell.created,
    };
  }

  async getRecommendationGraph(userDataId: number): Promise<RecommendationGraph> {
    const MAX_NODES = 500;
    const visitedUsers = new Set<number>();
    const visitedRecs = new Map<number, Recommendation>();
    const queue: number[] = [userDataId];

    // BFS: traverse all connected recommendations in both directions (capped)
    while (queue.length > 0 && visitedUsers.size < MAX_NODES) {
      const currentId = queue.shift();
      if (visitedUsers.has(currentId)) continue;
      visitedUsers.add(currentId);

      // Find all recommendations where this user is recommender OR recommended
      const [asRecommender, asRecommended] = await Promise.all([
        this.recommendationService.getAllRecommendationsByRecommenderId(currentId),
        this.recommendationService.getRecommendationsByRecommendedId(currentId),
      ]);

      for (const rec of [...asRecommender, ...asRecommended]) {
        if (visitedRecs.has(rec.id)) continue;
        visitedRecs.set(rec.id, rec);

        if (rec.recommender?.id && !visitedUsers.has(rec.recommender.id)) queue.push(rec.recommender.id);
        if (rec.recommended?.id && !visitedUsers.has(rec.recommended.id)) queue.push(rec.recommended.id);
      }
    }

    // Batch-load all user data
    const allUserIds = [...visitedUsers];
    const userDatas = await this.userDataService.getUserDataByIds(allUserIds);

    const nodes: RecommendationGraphNode[] = userDatas.map((ud) => ({
      id: ud.id,
      firstname: ud.firstname,
      surname: ud.surname,
      kycStatus: ud.kycStatus,
      kycLevel: ud.kycLevel,
      tradeApprovalDate: ud.tradeApprovalDate,
    }));

    const edges: RecommendationGraphEdge[] = [...visitedRecs.values()]
      .filter((r) => r.recommender?.id && r.recommended?.id)
      .map((r) => ({
        id: r.id,
        recommenderId: r.recommender.id,
        recommendedId: r.recommended.id,
        method: r.method,
        type: r.type,
        isConfirmed: r.isConfirmed,
        confirmationDate: r.confirmationDate,
        created: r.created,
      }));

    return { nodes, edges, rootId: userDataId };
  }

  async searchUserDataByKey(query: UserDataSupportQuery): Promise<UserDataSupportInfoResult> {
    const searchResult = await this.getUserDatasByKey(query.key);
    const bankTx = [ComplianceSearchType.IBAN, ComplianceSearchType.VIRTUAL_IBAN].includes(searchResult.type)
      ? await this.bankTxService.getUnassignedBankTx([query.key], [query.key])
      : searchResult.type === ComplianceSearchType.NAME
        ? await this.bankTxService.getBankTxsByName(query.key)
        : [];

    if (
      !searchResult.userDatas.length &&
      (!bankTx.length ||
        ![ComplianceSearchType.IBAN, ComplianceSearchType.VIRTUAL_IBAN, ComplianceSearchType.NAME].includes(
          searchResult.type,
        ))
    )
      throw new NotFoundException('No user or bankTx found');

    const uniqueUserDatas = Util.toUniqueList(searchResult.userDatas, 'id').sort((a, b) => a.id - b.id);

    const orgUserIds = uniqueUserDatas.filter((u) => u.accountType === AccountType.ORGANIZATION).map((u) => u.id);
    const onboardingStatuses = await this.getDfxApprovalStatuses(orgUserIds);

    return {
      type: searchResult.type,
      userDatas: uniqueUserDatas.map((u) => this.toUserDataDto(u, onboardingStatuses)),
      bankTx: bankTx.sort((a, b) => a.id - b.id).map((b) => this.toBankTxDto(b)),
    };
  }

  async getPendingOnboardings(): Promise<PendingOnboardingInfo[]> {
    const pendingEntries = await this.kycService.getPendingCompanyOnboardings();
    if (pendingEntries.length === 0) return [];

    const userDataIds = pendingEntries.map((e) => e.userDataId);
    const userDatas = await Promise.all(userDataIds.map((id) => this.userDataService.getUserData(id)));

    const dateMap = new Map(pendingEntries.map((e) => [e.userDataId, e.date]));

    return userDatas
      .filter((ud): ud is UserData => !!ud)
      .map((ud) => ({
        id: ud.id,
        name:
          ud.verifiedName ?? ([ud.firstname, ud.surname, ud.organization?.name].filter(Boolean).join(' ') || undefined),
        date: dateMap.get(ud.id) ?? ud.created,
      }));
  }

  //*** HELPER METHODS ***//

  private async getDfxApprovalStatuses(userDataIds: number[]): Promise<Map<number, OnboardingStatus>> {
    const steps = await this.kycService.getDfxApprovalSteps(userDataIds);

    const result = new Map<number, OnboardingStatus>();
    for (const step of steps) {
      if (step.status === ReviewStatus.FAILED) {
        result.set(step.userData.id, OnboardingStatus.REJECTED);
      } else {
        const parsed = step.result ? JSON.parse(step.result as string) : undefined;
        const decision = parsed?.complianceReview?.finalDecision;
        result.set(
          step.userData.id,
          decision === ComplianceDecision.REJECTED ? OnboardingStatus.REJECTED : OnboardingStatus.COMPLETED,
        );
      }
    }

    return result;
  }

  private async getUserDatasByKey(key: string): Promise<{ type: ComplianceSearchType; userDatas: UserData[] }> {
    if (key.includes('@'))
      return { type: ComplianceSearchType.MAIL, userDatas: await this.userDataService.getUsersByMail(key, false) };

    if (Config.formats.phone.test(key))
      return { type: ComplianceSearchType.PHONE, userDatas: await this.userDataService.getUsersByPhone(key) };

    if (isIP(key)) {
      const userDatas = await this.userService.getUsersByIp(key).then((u) => u.map((u) => u.userData));
      return { type: ComplianceSearchType.IP, userDatas };
    }

    const uniqueSearchResult = await this.getUniqueUserDataByKey(key);
    if (uniqueSearchResult.userData) return { type: uniqueSearchResult.type, userDatas: [uniqueSearchResult.userData] };

    if (IbanTools.validateIBAN(key).valid) {
      const virtualIban = await this.virtualIbanService.getByIban(key);
      if (virtualIban) {
        const bankTxUserDatas = await this.bankTxService
          .getBankTxsByVirtualIban(key)
          .then((txs) => txs.map((tx) => tx.userData));

        return { type: ComplianceSearchType.VIRTUAL_IBAN, userDatas: [...bankTxUserDatas, virtualIban.userData] };
      }

      // Normal IBAN search
      const userDatas = await Promise.all([
        this.bankDataService.getBankDatasByIban(key),
        this.bankTxReturnService.getBankTxReturnsByIban(key),
        this.buyCryptoService.getBuyCryptosByChargebackIban(key),
        this.sellService.getSellsByIban(key),
      ]).then((t) => t.flat().map((t) => t.userData));

      return { type: ComplianceSearchType.IBAN, userDatas };
    }

    // min requirement for a name
    if (key.length >= 2)
      return { type: ComplianceSearchType.NAME, userDatas: await this.userDataService.getUsersByName(key) };

    return { type: undefined, userDatas: [] };
  }

  private async getUniqueUserDataByKey(key: string): Promise<UserDataComplianceSearchTypePair> {
    if (Config.formats.number.test(key)) {
      const userData = await this.userDataService.getUserData(+key);
      if (userData) return { type: ComplianceSearchType.USER_DATA_ID, userData };
    }

    if (Config.formats.kycHash.test(key))
      return {
        type: ComplianceSearchType.KYC_HASH,
        userData: await this.userDataService.getUserDataByKey('kycHash', key),
      };

    if (Config.formats.transactionUid.test(key))
      return {
        type: ComplianceSearchType.TRANSACTION_UID,
        userData: await this.transactionService.getTransactionByKey('uid', key).then((t) => t?.userData),
      };

    if (Config.formats.bankUsage.test(key))
      return {
        type: ComplianceSearchType.BANK_USAGE,
        userData: await this.buyService.getBuyByKey('bankUsage', key, true).then((b) => b?.userData),
      };

    if (Config.formats.ref.test(key))
      return {
        type: ComplianceSearchType.REF,
        userData: await this.userService.getUserByKey('ref', key, true).then((u) => u?.userData),
      };

    if (Config.formats.accountServiceRef.test(key))
      return {
        type: ComplianceSearchType.ACCOUNT_SERVICE_REF,
        userData: await this.bankTxService.getBankTxByKey('accountServiceRef', key, true).then((b) => b?.userData),
      };

    if (Config.formats.address.test(key)) {
      const user = await this.userService.getUserByKey('address', key, true);
      if (user) return { type: ComplianceSearchType.USER_ADDRESS, userData: user.userData };

      return Promise.all([
        this.sellService.getSellByKey('deposit.address', key, true),
        this.swapService.getSwapByKey('deposit.address', key, true),
      ]).then((s) => {
        return { type: ComplianceSearchType.DEPOSIT_ADDRESS, userData: s.find((s) => s)?.userData };
      });
    }

    return Promise.all([
      this.buyCryptoService.getBuyCryptoByKeys(['txId', 'chargebackCryptoTxId'], key, true),
      this.buyFiatService.getBuyFiatByKey('chargebackTxId', key, true),
      this.payInService.getCryptoInputByKeys(['inTxId', 'outTxId', 'returnTxId'], key),
    ]).then((us) => {
      return { type: ComplianceSearchType.TXID, userData: us.find((u) => u)?.userData };
    });
  }

  private toUserDataDto(userData: UserData, onboardingStatuses?: Map<number, OnboardingStatus>): UserDataSupportInfo {
    const name =
      userData.verifiedName ??
      ([userData.firstname, userData.surname, userData.organization?.name].filter(Boolean).join(' ') || undefined);

    return {
      id: userData.id,
      kycStatus: userData.kycStatus,
      accountType: userData.accountType,
      mail: userData.mail,
      name,
      onboardingStatus:
        userData.accountType === AccountType.ORGANIZATION
          ? (onboardingStatuses?.get(userData.id) ?? OnboardingStatus.OPEN)
          : undefined,
    };
  }

  private toBankTxDto(bankTx: BankTx): BankTxSupportInfo {
    return {
      id: bankTx.id,
      transactionId: bankTx.transaction?.id,
      accountServiceRef: bankTx.accountServiceRef,
      amount: bankTx.amount,
      currency: bankTx.currency,
      type: bankTx.type,
      name: bankTx.completeName(),
      iban: bankTx.iban,
      remittanceInfo: bankTx.remittanceInfo,
    };
  }

  private toCryptoInputSupportInfo(ci: CryptoInput): CryptoInputSupportInfo {
    const blockchain = ci.asset?.blockchain ?? ci.address?.blockchain;
    return {
      id: ci.id,
      transactionId: ci.transaction?.id,
      inTxId: ci.inTxId,
      inTxExplorerUrl: blockchain ? txExplorerUrl(blockchain, ci.inTxId) : undefined,
      status: ci.status,
      amount: ci.amount,
      assetName: ci.asset?.name,
      blockchain,
      senderAddresses: ci.senderAddresses,
      returnTxId: ci.returnTxId,
      returnTxExplorerUrl: blockchain && ci.returnTxId ? txExplorerUrl(blockchain, ci.returnTxId) : undefined,
      purpose: ci.purpose,
    };
  }

  private toIpLogSupportInfo(ipLog: IpLog): IpLogSupportInfo {
    return {
      id: ipLog.id,
      ip: ipLog.ip,
      country: ipLog.country,
      url: ipLog.url,
      result: ipLog.result,
      created: ipLog.created,
    };
  }

  private toSupportIssueSupportInfo(issue: SupportIssue): SupportIssueSupportInfo {
    return {
      id: issue.id,
      uid: issue.uid,
      type: issue.type,
      state: issue.state,
      reason: issue.reason,
      name: issue.name,
      clerk: issue.clerk,
      department: issue.department,
      information: issue.information,
      messages: (issue.messages ?? [])
        .sort((a, b) => b.created.getTime() - a.created.getTime())
        .map((m) => ({ author: m.author, message: m.message, created: m.created })),
      transaction: issue.transaction
        ? {
            id: issue.transaction.id,
            uid: issue.transaction.uid,
            type: issue.transaction.type,
            sourceType: issue.transaction.sourceType,
            amountInChf: issue.transaction.amountInChf,
            amlCheck: issue.transaction.amlCheck,
          }
        : undefined,
      limitRequest: issue.limitRequest
        ? {
            limit: issue.limitRequest.limit,
            acceptedLimit: issue.limitRequest.acceptedLimit,
            decision: issue.limitRequest.decision,
            fundOrigin: issue.limitRequest.fundOrigin,
          }
        : undefined,
      created: issue.created,
    };
  }

  async getSupportUserInfo(userDataId: number): Promise<{ id: number; firstname: string; surname: string }> {
    const userData = await this.userDataService.getUserData(userDataId);
    if (!userData) throw new NotFoundException('User not found');
    return { id: userData.id, firstname: userData.firstname, surname: userData.surname };
  }

  // --- REFUND METHODS --- //

  async getTransactionRefundData(transactionId: number): Promise<RefundDataDto | undefined> {
    const transaction = await this.transactionService.getTransactionById(transactionId, {
      bankTx: { bankTxReturn: true },
      buyCrypto: { cryptoInput: true, bankTx: true, checkoutTx: true },
      buyFiat: { cryptoInput: true },
      userData: true,
    });

    if (!transaction) return undefined;

    // BuyCrypto chargeback
    if (transaction.buyCrypto) {
      if (transaction.buyCrypto.amlCheck === CheckStatus.PASS) return undefined;
      if (transaction.buyCrypto.chargebackAmount || transaction.buyCrypto.chargebackDate)
        throw new BadRequestException('Transaction already charged back');
      if (NotRefundableAmlReasons.includes(transaction.buyCrypto.amlReason))
        throw new BadRequestException('Cannot refund with this AML reason');

      const bankIn = transaction.buyCrypto.bankTx
        ? await this.bankService.getBankByIban(transaction.buyCrypto.bankTx.accountIban).then((b) => b?.name)
        : transaction.buyCrypto.checkoutTx
          ? CardBankName.CHECKOUT
          : undefined;

      const refundTarget = await this.getChargebackRefundTarget(transaction);
      const isFiat = !!transaction.buyCrypto.bankTx || !!transaction.buyCrypto.checkoutTx;

      const refundData = await this.transactionHelper.getRefundData(
        transaction.buyCrypto,
        transaction.userData,
        bankIn,
        refundTarget,
        isFiat,
      );

      this.refundList.set(transactionId, refundData);
      return refundData;
    }

    // BuyFiat chargeback
    if (transaction.buyFiat) {
      if (transaction.buyFiat.amlCheck === CheckStatus.PASS) return undefined;
      if (transaction.buyFiat.chargebackAmount || transaction.buyFiat.chargebackDate)
        throw new BadRequestException('Transaction already charged back');
      if (NotRefundableAmlReasons.includes(transaction.buyFiat.amlReason))
        throw new BadRequestException('Cannot refund with this AML reason');

      const refundTarget = transaction.buyFiat.chargebackAddress;

      const refundData = await this.transactionHelper.getRefundData(
        transaction.buyFiat,
        transaction.userData,
        undefined,
        refundTarget,
        false,
      );

      this.refundList.set(transactionId, refundData);
      return refundData;
    }

    // Unassigned BankTx return
    if (!transaction.bankTx) return undefined;
    if (!BankTxTypeUnassigned(transaction.bankTx.type)) return undefined;
    if (transaction.bankTx.bankTxReturn) throw new BadRequestException('Transaction already has a return');

    const bankIn = await this.bankService.getBankByIban(transaction.bankTx.accountIban).then((b) => b?.name);
    const refundTarget = transaction.bankTx.iban;

    const refundData = await this.transactionHelper.getRefundData(
      transaction.bankTx,
      transaction.userData,
      bankIn,
      refundTarget,
      true,
    );

    this.refundList.set(transactionId, refundData);

    return refundData;
  }

  async processTransactionRefund(transactionId: number, dto: BankRefundDto): Promise<boolean> {
    const transaction = await this.transactionService.getTransactionById(transactionId, {
      bankTx: { bankTxReturn: true },
      bankTxReturn: { bankTx: true, chargebackOutput: true },
      userData: true,
    });

    if (!transaction?.bankTx) throw new NotFoundException('Transaction not found');
    if (!BankTxTypeUnassigned(transaction.bankTx.type)) throw new BadRequestException('Transaction already assigned');

    const refundData = this.refundList.get(transactionId);
    if (!refundData) throw new BadRequestException('Request refund data first');
    if (!this.isRefundDataValid(refundData)) throw new BadRequestException('Refund data expired');
    this.refundList.delete(transactionId);

    // Create BankTxReturn if not exists
    if (!transaction.bankTxReturn) {
      // Load bankTx with transaction relation for the create method
      const bankTxWithRelations = await this.bankTxService.getBankTxById(transaction.bankTx.id, {
        transaction: { userData: true },
      });

      transaction.bankTxReturn = await this.bankTxService
        .updateInternal(bankTxWithRelations, { type: BankTxType.BANK_TX_RETURN })
        .then((b) => b.bankTxReturn);
    }

    // Process refund
    await this.bankTxReturnService.refundBankTx(transaction.bankTxReturn, {
      refundIban: dto.refundTarget,
      chargebackAmount: refundData.refundAmount,
      chargebackAllowedDate: new Date(),
      chargebackAllowedBy: 'Compliance',
      creditorData: {
        name: dto.name,
        address: dto.address,
        houseNumber: dto.houseNumber,
        zip: dto.zip,
        city: dto.city,
        country: dto.country,
      },
    });

    return true;
  }

  async processChargebackRefund(
    transactionId: number,
    dto: TransactionRefundDto,
    agentUserDataId: number,
  ): Promise<void> {
    const transaction = await this.transactionService.getTransactionById(transactionId, {
      buyCrypto: { cryptoInput: true, bankTx: true, checkoutTx: true },
      buyFiat: { cryptoInput: true },
      bankTx: { bankTxReturn: true },
      bankTxReturn: { bankTx: true, chargebackOutput: true },
      userData: true,
    });

    if (!transaction?.buyCrypto && !transaction?.buyFiat && !transaction?.bankTx)
      throw new NotFoundException('Transaction not found');

    const refundData = this.refundList.get(transactionId);
    if (!refundData) throw new BadRequestException('Request refund data first');
    if (!this.isRefundDataValid(refundData)) throw new BadRequestException('Refund data expired');
    this.refundList.delete(transactionId);

    if (dto.chargebackAmount != null && (dto.chargebackAmount <= 0 || dto.chargebackAmount > refundData.inputAmount))
      throw new BadRequestException('Chargeback amount must be greater than 0 and not exceed the transaction amount');

    const agent = await this.userDataService.getUserData(agentUserDataId);
    const chargebackAllowedBy = agent ? `Compliance/${agent.firstname}.${agent.surname}` : 'Compliance';

    const chargebackAmount = dto.chargebackAmount ?? refundData.refundAmount;
    const baseRefund = {
      chargebackAmount,
      chargebackCurrency: refundData.refundAsset.name,
      chargebackAllowedDate: new Date(),
      chargebackAllowedBy,
    };

    // BuyFiat refund (crypto back to sender)
    if (transaction.buyFiat) {
      return this.buyFiatService.refundBuyFiatInternal(transaction.buyFiat, {
        refundUserAddress: dto.refundTarget,
        ...baseRefund,
      });
    }

    // Unassigned BankTx return
    if (transaction.bankTx && BankTxTypeUnassigned(transaction.bankTx.type) && !transaction.buyCrypto) {
      if (!dto.creditorData) throw new BadRequestException('Creditor data is required for bank refunds');

      if (!transaction.bankTxReturn) {
        const bankTxWithRelations = await this.bankTxService.getBankTxById(transaction.bankTx.id, {
          transaction: { userData: true },
        });

        transaction.bankTxReturn = await this.bankTxService
          .updateInternal(bankTxWithRelations, { type: BankTxType.BANK_TX_RETURN })
          .then((b) => b.bankTxReturn);
      }

      return this.bankTxReturnService.refundBankTx(transaction.bankTxReturn, {
        refundIban: dto.refundTarget ?? refundData.refundTarget,
        creditorData: dto.creditorData,
        ...baseRefund,
      });
    }

    // BuyCrypto refunds
    const buyCrypto = transaction.buyCrypto;

    if (buyCrypto.checkoutTx) {
      return this.buyCryptoService.refundCheckoutTx(buyCrypto, baseRefund);
    }

    if (buyCrypto.cryptoInput) {
      return this.buyCryptoService.refundCryptoInput(buyCrypto, {
        refundUserAddress: dto.refundTarget,
        ...baseRefund,
      });
    }

    // Bank refund
    if (!dto.creditorData) throw new BadRequestException('Creditor data is required for bank refunds');

    return this.buyCryptoService.refundBankTx(buyCrypto, {
      refundIban: dto.refundTarget ?? refundData.refundTarget,
      creditorData: dto.creditorData,
      chargebackReferenceAmount: Util.roundReadable(
        refundData.refundPrice.invert().convert(chargebackAmount),
        AmountType.FIAT,
      ),
      ...baseRefund,
    });
  }

  private async getChargebackRefundTarget(transaction: Transaction): Promise<string | undefined> {
    const buyCrypto = transaction.buyCrypto;
    if (!buyCrypto) return undefined;

    if (buyCrypto.bankTx) {
      try {
        const iban = buyCrypto.bankTx.iban;
        if (iban && IbanTools.validateIBAN(iban).valid) return iban;
      } catch (_) {
        // fall through
      }
      return buyCrypto.chargebackIban;
    }

    if (buyCrypto.checkoutTx) {
      return `${buyCrypto.checkoutTx.cardBin}****${buyCrypto.checkoutTx.cardLast4}`;
    }

    return buyCrypto.chargebackIban;
  }

  private isRefundDataValid(refundData: RefundDataDto): boolean {
    return Util.secondsDiff(refundData.expiryDate) <= 0;
  }
}
