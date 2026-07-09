import { Injectable, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { FileType, KycFileDataDto } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { KycFileMapper } from 'src/subdomains/generic/kyc/dto/mapper/kyc-file.mapper';
import { KycFile } from 'src/subdomains/generic/kyc/entities/kyc-file.entity';
import { FileCategory } from 'src/subdomains/generic/kyc/enums/file-category.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycFileService } from 'src/subdomains/generic/kyc/services/kyc-file.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { RealUnitComplianceDtoMapper } from './dto/realunit-compliance-dto.mapper';
import { RealUnitCustomerDetailDto, RealUnitCustomerListDto, RealUnitKycFileDto } from './dto/realunit-compliance.dto';
import { RealUnitScopeService } from './realunit-scope.service';

// KYC file types a RealUnit staff member may see/download for their own customers: only customer-provided documents.
// DFX-generated AML work products (NAME_CHECK), compliance notes (USER_NOTES, TRANSACTION_NOTES) and the catch-all
// ADDITIONAL_DOCUMENTS bucket are intentionally excluded. Using enum members (not string literals) makes a future
// FileType rename a compile error rather than a silent hole.
export const REALUNIT_DOWNLOADABLE_FILE_TYPES: FileType[] = [
  FileType.IDENTIFICATION,
  FileType.USER_INFORMATION,
  FileType.RESIDENCE_PERMIT,
  FileType.STOCK_REGISTER,
  FileType.COMMERCIAL_REGISTER,
  FileType.STATUTES,
  FileType.AUTHORITY,
  FileType.SOLE_PROPRIETORSHIP_CONFIRMATION,
  FileType.ADDRESS_CHANGE,
  FileType.NAME_CHANGE,
];

// Read-only RealUnit compliance dashboard. Every method is strictly tenant-scoped and fail-closed: a non-member id
// is indistinguishable from a missing resource (404), and no DFX-internal / AML work product is ever reachable. It
// deliberately never touches the unscoped support dossier (support.service.getUserDataDetails) nor gs.service.
@Injectable()
export class RealUnitComplianceService {
  private readonly logger = new DfxLogger(RealUnitComplianceService);

  constructor(
    private readonly scopeService: RealUnitScopeService,
    private readonly userDataService: UserDataService,
    private readonly transactionService: TransactionService,
    private readonly bankDataService: BankDataService,
    private readonly buyService: BuyService,
    private readonly sellService: SellService,
    private readonly swapService: SwapService,
    private readonly virtualIbanService: VirtualIbanService,
    private readonly kycService: KycService,
    private readonly kycFileService: KycFileService,
    private readonly kycLogService: KycLogService,
    private readonly kycDocumentService: KycDocumentService,
    private readonly supportIssueService: SupportIssueService,
  ) {}

  // --- CUSTOMER SEARCH --- //

  // Without a key this lists the complete tenant scope, so the dashboard can show all RealUnit customers upfront.
  // The scope stays the sole membership definition; a key only narrows it down.
  async searchCustomers(key?: string): Promise<RealUnitCustomerListDto[]> {
    const customerIds = new Set(await this.scopeService.getCustomerIds());
    if (!customerIds.size) return []; // fail-closed: no RealUnit customers ⇒ empty result

    const resolved = key
      ? await this.resolveUserDatas(key)
      : await this.userDataService.getUserDataByIds([...customerIds]);
    const members = Util.toUniqueList(
      resolved.filter((u) => customerIds.has(u.id)),
      'id',
    ).sort((a, b) => a.id - b.id);

    return members.map(RealUnitComplianceDtoMapper.toCustomerListDto);
  }

  // --- REDUCED DOSSIER --- //

  async getReducedDossier(id: number): Promise<RealUnitCustomerDetailDto> {
    await this.scopeService.assertCustomer(id); // fail-closed 404 before any data is loaded

    const userData = await this.userDataService.getUserData(id);
    if (!userData) throw new NotFoundException('Not found');

    const [
      kycFiles,
      kycSteps,
      transactions,
      bankDatas,
      buyRoutes,
      sellRoutes,
      swapRoutes,
      virtualIbans,
      supportIssues,
    ] = await Promise.all([
      this.kycFileService.getUserDataKycFiles(id),
      this.kycService.getStepsByUserData(id),
      this.transactionService.getTransactionsByUserDataId(id),
      this.bankDataService.getBankDatasByUserData(id),
      this.buyService.getUserDataBuys(id),
      this.sellService.getSellsByUserDataId(id),
      this.swapService.getSwapsByUserDataId(id),
      this.virtualIbanService.getVirtualIbansForAccount(id),
      this.supportIssueService.getIssueEntities(id),
    ]);

    return RealUnitComplianceDtoMapper.toCustomerDetailDto(userData, {
      kycFiles: this.filterDownloadableFiles(kycFiles),
      kycSteps,
      transactions,
      bankDatas,
      buyRoutes,
      sellRoutes,
      swapRoutes,
      virtualIbans,
      supportIssues,
    });
  }

  // --- KYC FILES --- //

  async listCustomerFiles(id: number): Promise<RealUnitKycFileDto[]> {
    await this.scopeService.assertCustomer(id); // fail-closed 404

    const files = await this.kycFileService.getUserDataKycFiles(id);
    return this.filterDownloadableFiles(files).map(RealUnitComplianceDtoMapper.toKycFileDto);
  }

  async downloadCustomerFile(id: number, uid: string, jwt: JwtPayload): Promise<KycFileDataDto> {
    await this.scopeService.assertCustomer(id); // fail-closed 404: id must be one of the staff's own customers

    const kycFile = await this.kycFileService.getKycFile(uid); // userData is eager
    if (!kycFile) throw new NotFoundException('Not found');
    if (kycFile.userData?.id !== id) throw new NotFoundException('Not found'); // membership: file must belong to that customer
    if (!REALUNIT_DOWNLOADABLE_FILE_TYPES.includes(kycFile.type)) throw new NotFoundException('Not found'); // allowlist

    const blob = await this.kycDocumentService.downloadFile(
      FileCategory.USER,
      kycFile.userData.id,
      kycFile.type,
      kycFile.name,
    );

    // Mandatory regulatory audit trail: record which RealUnit staff account downloaded which file.
    const log = `RealUnit staff ${jwt.account} is downloading KYC file ${kycFile.name} (ID: ${kycFile.id})`;
    this.logger.verbose(`RealUnit staff ${jwt.account} downloading KYC file ${kycFile.id} of customer ${id}`);
    await this.kycLogService.createKycFileLog(log, kycFile.userData);

    return KycFileMapper.mapKycFile(kycFile, blob);
  }

  // --- HELPER METHODS --- //

  // A focused, RealUnit-safe equivalent of the compliance key resolver: it never runs the unscoped cross-customer
  // bankTx lookups (getUnassignedBankTx/getBankTxsByName), so those unscopable arrays can never surface. Callers
  // still filter the result down to RealUnit members, so a non-member match is silently dropped.
  private async resolveUserDatas(key: string): Promise<UserData[]> {
    if (key.includes('@')) return this.userDataService.getUsersByMail(key, false);
    if (Config.formats.phone.test(key)) return this.userDataService.getUsersByPhone(key);

    if (Config.formats.number.test(key)) {
      const userData = await this.userDataService.getUserData(+key);
      return userData ? [userData] : [];
    }

    if (key.length >= 2) return this.userDataService.getUsersByName(key);

    return [];
  }

  private filterDownloadableFiles(files: KycFile[]): KycFile[] {
    return files.filter((f) => REALUNIT_DOWNLOADABLE_FILE_TYPES.includes(f.type));
  }
}
