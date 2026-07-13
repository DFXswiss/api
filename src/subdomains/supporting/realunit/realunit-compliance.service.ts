import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import JSZip from 'jszip';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
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
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { RealUnitComplianceDtoMapper } from './dto/realunit-compliance-dto.mapper';
import { RealUnitCustomerDetailDto, RealUnitCustomerListDto, RealUnitKycFileDto } from './dto/realunit-compliance.dto';
import { RealUnitService } from './realunit.service';
import { RealUnitScopeService } from './realunit-scope.service';

// Postgres integer upper bound: larger numeric keys cannot be an id and would fail the DB query
const MaxDbId = 2147483647;

// KYC file types a RealUnit staff member may see/download for their own customers: customer-provided documents
// plus the two mandatory check evidences (ident check via IDENTIFICATION, Dilisense name check via NAME_CHECK).
// Compliance notes (USER_NOTES, TRANSACTION_NOTES) and the catch-all ADDITIONAL_DOCUMENTS bucket are intentionally
// excluded. Using enum members (not string literals) makes a future FileType rename a compile error rather than a
// silent hole.
export const REALUNIT_DOWNLOADABLE_FILE_TYPES: FileType[] = [
  FileType.IDENTIFICATION,
  FileType.NAME_CHECK,
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

// Assets whose transactions are visible in the RealUnit dossier. RealUnit staff must see the customer's REALU and
// ZCHF transactions; any other DFX business of the same account (BTC, ETH, ...) stays hidden.
export const REALUNIT_VISIBLE_TX_ASSETS: string[] = ['REALU', 'ZCHF'];

// Read-only RealUnit compliance dashboard. Every method is strictly tenant-scoped and fail-closed: a non-member id
// is indistinguishable from a missing resource (404), and no DFX-internal / AML work product is ever reachable. It
// deliberately never touches the unscoped support dossier (support.service.getUserDataDetails) nor gs.service.
@Injectable()
export class RealUnitComplianceService {
  private readonly logger = new DfxLogger(RealUnitComplianceService);

  // address (lowercase) -> raw REALU balance from the ponder indexer; refreshed lazily every 5 minutes
  private readonly holderBalanceCache = new AsyncCache<Map<string, string>>(CacheItemResetPeriod.EVERY_5_MINUTES);

  constructor(
    private readonly scopeService: RealUnitScopeService,
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
    private readonly realUnitService: RealUnitService,
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

    const balances = await this.getMemberBalances(members.map((m) => m.id));

    return members.map((m) => RealUnitComplianceDtoMapper.toCustomerListDto(m, balances.get(m.id)));
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
      // asset filter runs in SQL so the take-limit applies to REALU/ZCHF rows, not to "newest 100 of anything"
      this.transactionService.getTransactionsByUserDataId(id, REALUNIT_VISIBLE_TX_ASSETS),
      this.bankDataService.getBankDatasByUserData(id),
      this.buyService.getUserDataBuys(id),
      this.sellService.getSellsByUserDataId(id),
      this.swapService.getSwapsByUserDataId(id),
      this.virtualIbanService.getVirtualIbansForAccount(id),
      this.supportIssueService.getIssueEntities(id),
    ]);

    const balance = (await this.getMemberBalances([id])).get(id);

    return RealUnitComplianceDtoMapper.toCustomerDetailDto(userData, balance, {
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

  // --- FULL DOSSIER --- //

  // Bundles every allowlisted file of the customer into one ZIP, grouped by file type. Same tenant and allowlist
  // boundaries as the single-file download. A file that cannot be fetched does not abort the export — it is listed
  // in MISSING_FILES.txt — but if NOTHING could be fetched the request fails instead of returning an empty ZIP.
  // The audit log records exported and missing file ids separately.
  async downloadCustomerDossier(id: number, jwt: JwtPayload): Promise<Buffer> {
    await this.scopeService.assertCustomer(id); // fail-closed 404

    const userData = await this.userDataService.getUserData(id);
    if (!userData) throw new NotFoundException('Not found');

    const files = await this.kycFileService.getUserDataKycFiles(id).then((f) => this.filterDownloadableFiles(f));
    if (!files.length) throw new NotFoundException('Not found');

    const zip = new JSZip();
    const usedPaths = new Set<string>();
    const exported: number[] = [];
    const missing: KycFile[] = [];

    for (const file of files) {
      try {
        const blob = await this.kycDocumentService.downloadFile(FileCategory.USER, id, file.type, file.name);
        // file.name may end with a raw customer upload name — sanitize the entry path (zip-slip)
        const sanitized = this.sanitizePathComponent(file.name);
        // Ensure a unique ZIP entry path so no file silently overwrites another — otherwise the audit trail below
        // would record a file as exported that is absent from the bundle. The unique file.id prefix resolves any
        // base-name collision; the counter guards the pathological case of the id-prefixed form colliding too.
        let entryName = `${file.type}/${sanitized}`;
        for (let n = 0; usedPaths.has(entryName); n++) {
          entryName = n === 0 ? `${file.type}/${file.id}_${sanitized}` : `${file.type}/${file.id}_${n}_${sanitized}`;
        }
        usedPaths.add(entryName);
        zip.file(entryName, blob.data);
        exported.push(file.id);
      } catch (e) {
        this.logger.warn(`Dossier export: file ${file.id} of customer ${id} not downloadable:`, e);
        missing.push(file);
      }
    }

    if (!exported.length) throw new ServiceUnavailableException('Dossier export failed: no file could be fetched');

    if (missing.length)
      zip.file(
        'MISSING_FILES.txt',
        missing.map((f) => `${f.type}/${this.sanitizePathComponent(f.name)} (ID: ${f.id})`).join('\n'),
      );

    // Mandatory regulatory audit trail: one aggregated entry recording what was actually exported.
    const log = `RealUnit staff ${jwt.account} is downloading the full dossier of customer ${id} (exported files: ${exported.join(
      ', ',
    )}${missing.length ? `; not fetchable: ${missing.map((f) => f.id).join(', ')}` : ''})`;
    this.logger.verbose(`RealUnit staff ${jwt.account} downloading full dossier of customer ${id}`);
    await this.kycLogService.createKycFileLog(log, userData);

    return zip.generateAsync({ type: 'nodebuffer' });
  }

  // --- HELPER METHODS --- //

  // A focused, RealUnit-safe equivalent of the compliance key resolver: it never runs the unscoped cross-customer
  // bankTx lookups (getUnassignedBankTx/getBankTxsByName), so those unscopable arrays can never surface. Callers
  // still filter the result down to RealUnit members, so a non-member match is silently dropped.
  private async resolveUserDatas(key: string): Promise<UserData[]> {
    if (key.includes('@')) return this.userDataService.getUsersByMail(key, false);
    if (Config.formats.phone.test(key)) return this.userDataService.getUsersByPhone(key);

    if (Config.formats.number.test(key) && +key <= MaxDbId) {
      const userData = await this.userDataService.getUserData(+key);
      return userData ? [userData] : [];
    }

    if (key.length >= 2) return this.userDataService.getUsersByName(key);

    return [];
  }

  private filterDownloadableFiles(files: KycFile[]): KycFile[] {
    return files.filter((f) => REALUNIT_DOWNLOADABLE_FILE_TYPES.includes(f.type));
  }

  // Current REALU holdings per customer: sum of the indexer balances over all wallet addresses of the account.
  // Returns share counts (asset decimals applied). Fail-open to an EMPTY map when the indexer or asset lookup is
  // unavailable — the dashboard then shows the balance as unknown instead of failing the whole customer list.
  private async getMemberBalances(userDataIds: number[]): Promise<Map<number, number>> {
    try {
      const [users, holderBalances, realuAsset] = await Promise.all([
        this.userService.getUsersByUserDataIds(userDataIds),
        this.getHolderBalances(),
        this.realUnitService.getRealuAsset(),
      ]);

      const balances = new Map<number, number>(userDataIds.map((id) => [id, 0]));
      for (const user of users) {
        const raw = user.address && holderBalances.get(user.address.toLowerCase());
        if (!raw) continue;

        const userDataId = user.userData.id;
        balances.set(userDataId, (balances.get(userDataId) ?? 0) + EvmUtil.fromWeiAmount(raw, realuAsset.decimals));
      }

      return balances;
    } catch (e) {
      this.logger.warn('Could not resolve REALU balances:', e);
      return new Map();
    }
  }

  private async getHolderBalances(): Promise<Map<string, string>> {
    return this.holderBalanceCache.get('holders', async () => {
      const map = new Map<string, string>();

      let after: string | undefined;
      do {
        const page = await this.realUnitService.getHolders(1000, undefined, after);
        for (const holder of page.holders) map.set(holder.address.toLowerCase(), holder.balance);
        after = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : undefined;
      } while (after);

      return map;
    });
  }

  // ZIP entry paths must not carry traversal payloads from customer-influenced file names.
  private sanitizePathComponent(name: string): string {
    return name.replace(/[\\/]/g, '_').replace(/\.\.+/g, '_');
  }
}
