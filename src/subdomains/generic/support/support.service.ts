import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PdfUtil } from 'src/shared/utils/pdf.util';
import { isIP } from 'class-validator';
import * as IbanTools from 'ibantools';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { RefundDataDto } from 'src/subdomains/core/history/dto/refund-data.dto';
import { BankRefundDto } from 'src/subdomains/core/history/dto/transaction-refund.dto';
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
import { FileSubType, FileType } from '../kyc/dto/kyc-file.dto';
import { ContentType } from '../kyc/enums/content-type.enum';
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
import { GenerateOnboardingPdfDto } from './dto/onboarding-pdf.dto';
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
  ) {}

  async generateIpLogPdf(userDataId: number): Promise<string> {
    const ipLogs = await this.ipLogService.getByUserDataId(userDataId);

    return new Promise<string>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

        PdfUtil.drawLogo(pdf);

        // Header
        const marginX = 50;
        pdf.moveDown(2);
        pdf.fontSize(18).font('Helvetica-Bold').fillColor('#072440');
        pdf.text('IP Log Report', marginX);
        pdf.moveDown(0.5);
        pdf.fontSize(10).font('Helvetica').fillColor('#333333');
        pdf.text(`User Data ID: ${userDataId}`, marginX);
        pdf.text(`Date: ${new Date().toISOString().split('T')[0]}`, marginX);
        pdf.text(`Total Entries: ${ipLogs.length}`, marginX);
        pdf.moveDown(1);

        // Table
        this.drawIpLogTable(pdf, ipLogs);

        // Footer
        pdf.moveDown(2);
        pdf.fontSize(8).font('Helvetica').fillColor('#999999');
        pdf.text(`Generated by DFX - ${new Date().toISOString()}`, marginX);

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawIpLogTable(pdf: InstanceType<typeof PDFDocument>, ipLogs: IpLog[]): void {
    const marginX = 50;
    const { width } = pdf.page;
    const tableWidth = width - marginX * 2;

    const cols = [
      { header: 'Date', width: tableWidth * 0.2 },
      { header: 'IP', width: tableWidth * 0.2 },
      { header: 'Country', width: tableWidth * 0.12 },
      { header: 'Endpoint', width: tableWidth * 0.36 },
      { header: 'Status', width: tableWidth * 0.12 },
    ];

    let y = pdf.y;

    // Headers
    pdf.fontSize(10).font('Helvetica-Bold').fillColor('#072440');
    let x = marginX;
    for (const col of cols) {
      pdf.text(col.header, x, y, { width: col.width - 5 });
      x += col.width;
    }

    y += 18;
    pdf
      .moveTo(marginX, y)
      .lineTo(width - marginX, y)
      .stroke('#CCCCCC');
    y += 8;

    // Rows
    pdf.fontSize(9).font('Helvetica').fillColor('#333333');

    if (ipLogs.length === 0) {
      pdf.text('No IP logs found', marginX, y);
    } else {
      for (const log of ipLogs) {
        if (y > pdf.page.height - 80) {
          pdf.addPage();
          y = 50;
        }

        x = marginX;
        const date = log.created ? new Date(log.created).toISOString().replace('T', ' ').substring(0, 19) : '-';
        const endpoint = log.url?.replace('/v1/', '') ?? '-';

        pdf.fillColor('#333333');
        pdf.text(date, x, y, { width: cols[0].width - 5 });
        x += cols[0].width;
        pdf.text(log.ip ?? '-', x, y, { width: cols[1].width - 5 });
        x += cols[1].width;
        pdf.text(log.country ?? '-', x, y, { width: cols[2].width - 5 });
        x += cols[2].width;
        pdf.text(endpoint, x, y, { width: cols[3].width - 5 });
        x += cols[3].width;

        pdf.fillColor(log.result ? '#28a745' : '#dc3545');
        pdf.text(log.result ? 'Pass' : 'Fail', x, y, { width: cols[4].width - 5 });

        y += 20;
      }
    }

    pdf
      .moveTo(marginX, y)
      .lineTo(width - marginX, y)
      .stroke('#CCCCCC');
    pdf.y = y + 10;
  }

  async generateTransactionPdf(userDataId: number): Promise<string> {
    const transactions = await this.transactionService.getTransactionsByUserDataId(userDataId);

    return new Promise<string>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
        const chunks: Buffer[] = [];

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

        PdfUtil.drawLogo(pdf);

        // Header
        const marginX = 40;
        pdf.moveDown(2);
        pdf.fontSize(18).font('Helvetica-Bold').fillColor('#072440');
        pdf.text('Transaction Report', marginX);
        pdf.moveDown(0.5);
        pdf.fontSize(10).font('Helvetica').fillColor('#333333');
        pdf.text(`User Data ID: ${userDataId}`, marginX);
        pdf.text(`Date: ${new Date().toISOString().split('T')[0]}`, marginX);
        pdf.text(`Total Entries: ${transactions.length}`, marginX);
        pdf.moveDown(1);

        // Table
        this.drawTransactionTable(pdf, transactions);

        // Footer
        pdf.moveDown(2);
        pdf.fontSize(8).font('Helvetica').fillColor('#999999');
        pdf.text(`Generated by DFX - ${new Date().toISOString()}`, marginX);

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawTransactionTable(pdf: InstanceType<typeof PDFDocument>, transactions: Transaction[]): void {
    const marginX = 40;
    const { width } = pdf.page;
    const tableWidth = width - marginX * 2;

    const cols = [
      { header: 'ID', width: tableWidth * 0.05 },
      { header: 'UID', width: tableWidth * 0.12 },
      { header: 'Type', width: tableWidth * 0.08 },
      { header: 'Source', width: tableWidth * 0.1 },
      { header: 'Input', width: tableWidth * 0.15 },
      { header: 'CHF', width: tableWidth * 0.1 },
      { header: 'EUR', width: tableWidth * 0.1 },
      { header: 'AML', width: tableWidth * 0.1 },
      { header: 'Chargeback', width: tableWidth * 0.1 },
      { header: 'Created', width: tableWidth * 0.1 },
    ];

    let y = pdf.y;

    // Headers
    pdf.fontSize(8).font('Helvetica-Bold').fillColor('#072440');
    let x = marginX;
    for (const col of cols) {
      pdf.text(col.header, x, y, { width: col.width - 4 });
      x += col.width;
    }

    y += 16;
    pdf
      .moveTo(marginX, y)
      .lineTo(width - marginX, y)
      .stroke('#CCCCCC');
    y += 6;

    // Rows
    pdf.fontSize(7).font('Helvetica').fillColor('#333333');

    if (transactions.length === 0) {
      pdf.text('No transactions found', marginX, y);
    } else {
      for (const tx of transactions) {
        if (y > pdf.page.height - 60) {
          pdf.addPage();
          y = 40;
        }

        const info = this.toTransactionSupportInfo(tx);
        const date = info.created ? new Date(info.created).toISOString().split('T')[0] : '-';
        const input = info.inputAmount != null ? `${info.inputAmount.toFixed(2)} ${info.inputAsset ?? ''}` : '-';
        const chargeback = info.chargebackDate ? new Date(info.chargebackDate).toISOString().split('T')[0] : '-';

        x = marginX;
        pdf.fillColor('#333333');
        pdf.text(String(info.id), x, y, { width: cols[0].width - 4 });
        x += cols[0].width;
        pdf.text(info.uid ?? '-', x, y, { width: cols[1].width - 4 });
        x += cols[1].width;
        pdf.text(info.type ?? '-', x, y, { width: cols[2].width - 4 });
        x += cols[2].width;
        pdf.text(info.sourceType ?? '-', x, y, { width: cols[3].width - 4 });
        x += cols[3].width;
        pdf.text(input, x, y, { width: cols[4].width - 4 });
        x += cols[4].width;
        pdf.text(info.amountInChf?.toFixed(2) ?? '-', x, y, { width: cols[5].width - 4 });
        x += cols[5].width;
        pdf.text(info.amountInEur?.toFixed(2) ?? '-', x, y, { width: cols[6].width - 4 });
        x += cols[6].width;
        pdf.text(info.amlCheck ?? '-', x, y, { width: cols[7].width - 4 });
        x += cols[7].width;

        if (chargeback !== '-') {
          pdf.fillColor('#dc3545');
        }
        pdf.text(chargeback, x, y, { width: cols[8].width - 4 });
        x += cols[8].width;

        pdf.fillColor('#333333');
        pdf.text(date, x, y, { width: cols[9].width - 4 });

        y += 16;
      }
    }

    pdf
      .moveTo(marginX, y)
      .lineTo(width - marginX, y)
      .stroke('#CCCCCC');
    pdf.y = y + 10;
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
    const pdfData = await this.createOnboardingPdf(userData, kycFiles, kycSteps, dto);

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

  private async createOnboardingPdf(
    userData: UserData,
    kycFiles: { name: string; type: string; subType?: string }[],
    kycSteps: KycStep[],
    dto: GenerateOnboardingPdfDto,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        const pdf = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];

        pdf.on('data', (chunk) => chunks.push(chunk));
        pdf.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

        PdfUtil.drawLogo(pdf);

        const marginX = 50;
        const { width } = pdf.page;

        // Header
        pdf.moveDown(2);
        pdf.fontSize(18).font('Helvetica-Bold').fillColor('#072440');
        pdf.text('GwG Kunden Onboarding', marginX);
        pdf.moveDown(0.5);
        pdf.fontSize(10).font('Helvetica').fillColor('#333333');
        pdf.text(`UserData ID: ${userData.id}`, marginX);
        pdf.text(`Datum: ${new Date().toISOString().split('T')[0]}`, marginX);
        pdf.moveDown(1);

        // User Data Section
        this.drawOnboardingSectionHeader(pdf, 'Benutzerdaten', marginX);
        this.drawOnboardingField(pdf, 'Account Type', userData.accountType ?? '-', marginX, width);
        this.drawOnboardingField(pdf, 'Name', userData.completeName ?? '-', marginX, width);
        this.drawOnboardingField(
          pdf,
          'Adresse',
          [userData.street, userData.zip, userData.location].filter(Boolean).join(', ') || '-',
          marginX,
          width,
        );
        this.drawOnboardingField(
          pdf,
          'Geburtstag',
          userData.birthday ? new Date(userData.birthday).toISOString().split('T')[0] : '-',
          marginX,
          width,
        );
        this.drawOnboardingField(pdf, 'E-Mail', userData.mail ?? '-', marginX, width);
        this.drawOnboardingField(pdf, 'Telefon', userData.phone ?? '-', marginX, width);
        this.drawOnboardingField(pdf, 'Sprache', userData.language?.name ?? '-', marginX, width);
        this.drawOnboardingField(pdf, 'Nationalität', userData.nationality?.name ?? '-', marginX, width);
        this.drawOnboardingField(pdf, 'PEP Status', userData.pep ? 'Ja' : 'Nein', marginX, width);
        this.drawOnboardingField(pdf, 'KYC Hash', userData.kycHash ?? '-', marginX, width);
        this.drawOnboardingField(
          pdf,
          'Account Opener Authorization',
          userData.accountOpenerAuthorization ? 'Ja' : 'Nein',
          marginX,
          width,
        );
        pdf.moveDown(1);

        // Organization Data (if applicable)
        if (userData.organization) {
          this.drawOnboardingSectionHeader(pdf, 'Organisation', marginX);
          this.drawOnboardingField(pdf, 'Name', userData.organizationName ?? '-', marginX, width);
          this.drawOnboardingField(pdf, 'Legal Entity', userData.legalEntity ?? '-', marginX, width);
          this.drawOnboardingField(pdf, 'Signatory Power', userData.signatoryPower ?? '-', marginX, width);

          // Get operational activity from KycStep
          const operationalActivityStep = kycSteps.find((s) => s.name === KycStepName.OPERATIONAL_ACTIVITY);
          if (operationalActivityStep?.result) {
            try {
              const opResult = JSON.parse(operationalActivityStep.result) as Record<string, unknown>;
              this.drawOnboardingField(
                pdf,
                'Operational Activity',
                opResult.isOperational != null ? String(opResult.isOperational) : '-',
                marginX,
                width,
              );
              this.drawOnboardingField(
                pdf,
                'Website',
                opResult.websiteUrl ? String(opResult.websiteUrl) : '-',
                marginX,
                width,
              );
            } catch {
              // ignore parse errors
            }
          }
          pdf.moveDown(1);
        }

        // KycSteps with result data (Financial Data, Beneficial Owners)
        const financialDataStep = kycSteps.find((s) => s.name === KycStepName.FINANCIAL_DATA);
        if (financialDataStep?.result) {
          try {
            const financialData = JSON.parse(financialDataStep.result) as unknown;
            this.drawOnboardingSectionHeader(pdf, 'Financial Data', marginX);
            this.drawOnboardingKeyValueObject(pdf, financialData, marginX, width);
            pdf.moveDown(1);
          } catch {
            // ignore parse errors
          }
        }

        const beneficialOwnerStep = kycSteps.find((s) => s.name === KycStepName.BENEFICIAL_OWNER);
        if (beneficialOwnerStep?.result) {
          try {
            const beneficialData = JSON.parse(beneficialOwnerStep.result) as unknown;
            this.drawOnboardingSectionHeader(pdf, 'Beneficial Owners', marginX);
            this.drawOnboardingKeyValueObject(pdf, beneficialData, marginX, width);
            pdf.moveDown(1);
          } catch {
            // ignore parse errors
          }
        }

        // Documents Section
        this.drawOnboardingSectionHeader(pdf, 'Dokumente', marginX);
        const documentTypes = [
          'Deckblatt',
          'Identifikationsdokument',
          'Formular A',
          'Formular K',
          'Name Checks',
          'Handelsregister',
          'Vollmacht',
          'Aktienbuch',
        ];
        for (const docType of documentTypes) {
          const file = kycFiles.find((f) => f.name.toLowerCase().includes(docType.toLowerCase()));
          this.drawOnboardingField(pdf, docType, file?.name ?? 'nicht vorhanden', marginX, width);
        }
        pdf.moveDown(1);

        // Compliance Fields
        this.drawOnboardingSectionHeader(pdf, 'Compliance Bewertung', marginX);
        this.drawOnboardingField(pdf, 'Complex Org Structure', dto.complexOrgStructure ?? '-', marginX, width);
        this.drawOnboardingField(pdf, 'HighRisk Einstufung', dto.highRisk ?? '-', marginX, width);
        this.drawOnboardingField(pdf, 'Deposit Limit', dto.depositLimit ?? '-', marginX, width);
        this.drawOnboardingField(pdf, 'AML Account Type', dto.amlAccountType ?? '-', marginX, width);
        pdf.moveDown(1);

        // Text Fields
        if (dto.commentGmeR) {
          this.drawOnboardingSectionHeader(pdf, 'Kommentar GmeR', marginX);
          pdf.fontSize(9).font('Helvetica').fillColor('#333333');
          pdf.text(dto.commentGmeR, marginX, pdf.y, { width: width - marginX * 2 });
          pdf.moveDown(1);
        }

        if (dto.reasonSeatingCompany) {
          this.drawOnboardingSectionHeader(pdf, 'Sitzgesellschaft Begründung', marginX);
          pdf.fontSize(9).font('Helvetica').fillColor('#333333');
          pdf.text(dto.reasonSeatingCompany, marginX, pdf.y, { width: width - marginX * 2 });
          pdf.moveDown(1);
        }

        if (dto.businessActivities) {
          this.drawOnboardingSectionHeader(pdf, 'Geschäftliche Aktivitäten', marginX);
          pdf.fontSize(9).font('Helvetica').fillColor('#333333');
          pdf.text(dto.businessActivities, marginX, pdf.y, { width: width - marginX * 2 });
          pdf.moveDown(1);
        }

        // Footer with Final Decision
        pdf.moveDown(2);
        pdf
          .moveTo(marginX, pdf.y)
          .lineTo(width - marginX, pdf.y)
          .stroke('#CCCCCC');
        pdf.moveDown(1);

        pdf.fontSize(12).font('Helvetica-Bold');
        pdf.fillColor(dto.finalDecision === 'Akzeptiert' ? '#28a745' : '#dc3545');
        pdf.text(`Finaler Entscheid: ${dto.finalDecision}`, marginX);
        pdf.moveDown(0.5);

        pdf.fontSize(10).font('Helvetica').fillColor('#333333');
        pdf.text(`Bearbeitet von: ${dto.processedBy}`, marginX);
        pdf.text(`UTC Datum: ${new Date().toISOString()}`, marginX);

        pdf.moveDown(2);
        pdf.fontSize(8).font('Helvetica').fillColor('#999999');
        pdf.text(`Generated by DFX - ${new Date().toISOString()}`, marginX);

        pdf.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawOnboardingSectionHeader(pdf: InstanceType<typeof PDFDocument>, title: string, marginX: number): void {
    if (pdf.y > pdf.page.height - 100) {
      pdf.addPage();
    }
    pdf.fontSize(12).font('Helvetica-Bold').fillColor('#072440');
    pdf.text(title, marginX);
    pdf.moveDown(0.3);
  }

  private drawOnboardingField(
    pdf: InstanceType<typeof PDFDocument>,
    label: string,
    value: string,
    marginX: number,
    pageWidth: number,
  ): void {
    if (pdf.y > pdf.page.height - 60) {
      pdf.addPage();
    }
    const labelWidth = 180;
    const y = pdf.y;

    pdf.fontSize(9).font('Helvetica-Bold').fillColor('#666666');
    pdf.text(label, marginX, y, { width: labelWidth, continued: false });

    pdf.fontSize(9).font('Helvetica').fillColor('#333333');
    pdf.text(value, marginX + labelWidth, y, { width: pageWidth - marginX * 2 - labelWidth });

    pdf.y = Math.max(pdf.y, y + 14);
  }

  private drawOnboardingKeyValueObject(
    pdf: InstanceType<typeof PDFDocument>,
    data: unknown,
    marginX: number,
    pageWidth: number,
  ): void {
    // Handle array of {key, value} objects (e.g. FinancialData)
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === 'object' && 'key' in item) {
          const key = String((item as { key: unknown }).key);
          const rawValue = (item as { value: unknown }).value;
          const value = this.formatPdfValue(rawValue);
          this.drawOnboardingField(pdf, key, value, marginX, pageWidth);
        }
      }
      return;
    }

    // Handle flat object (e.g. BeneficialOwner)
    if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (value === null || value === undefined) continue;
        const displayValue = this.formatPdfValue(value);
        this.drawOnboardingField(pdf, key, displayValue, marginX, pageWidth);
      }
    }
  }

  private formatPdfValue(value: unknown): string {
    if (value === null || value === undefined) return '-';
    // For primitives (string, number, boolean), just convert to string
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    // For everything else (arrays, objects), use JSON.stringify
    try {
      return JSON.stringify(value);
    } catch {
      return '-';
    }
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
    const onboardingStatuses = await this.kycService.getDfxApprovalStatuses(orgUserIds);

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

  // --- REFUND METHODS --- //

  async getTransactionRefundData(transactionId: number): Promise<RefundDataDto | undefined> {
    const transaction = await this.transactionService.getTransactionById(transactionId, {
      bankTx: { bankTxReturn: true },
      userData: true,
    });

    if (!transaction?.bankTx) return undefined;
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

  private isRefundDataValid(refundData: RefundDataDto): boolean {
    return Util.secondsDiff(refundData.expiryDate) <= 0;
  }
}
