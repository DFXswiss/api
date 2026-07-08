import { addressExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Util } from 'src/shared/utils/util';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { FileType } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import { KycFile } from 'src/subdomains/generic/kyc/entities/kyc-file.entity';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import {
  BuySupportInfo,
  SellSupportInfo,
  SwapSupportInfo,
  VirtualIbanSupportInfo,
} from 'src/subdomains/generic/support/dto/user-data-support.dto';
import { toCountryDto, toLanguageDto, toOrganizationDto } from 'src/subdomains/generic/support/user-data-detail.mapper';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { VirtualIban } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import {
  RealUnitChecksDto,
  RealUnitCustomerDetailDto,
  RealUnitCustomerListDto,
  RealUnitDossierBankDataDto,
  RealUnitDossierKycStepDto,
  RealUnitDossierSupportIssueDto,
  RealUnitDossierTxDto,
  RealUnitKycFileDto,
} from './realunit-compliance.dto';

interface RealUnitDossierSlices {
  kycFiles: KycFile[];
  kycSteps: KycStep[];
  transactions: Transaction[];
  bankDatas: BankData[];
  buyRoutes: Buy[];
  sellRoutes: Sell[];
  swapRoutes: Swap[];
  virtualIbans: VirtualIban[];
  supportIssues: SupportIssue[];
}

// Builds the reduced RealUnit compliance DTOs from entities. Every field is listed explicitly (whitelist); no field
// is ever copied wholesale from an entity, so DFX-internal or AML fields cannot leak. The recommendation/referral
// graph (kyc steps) and cross-customer bank-data alternatives are deliberately left unpopulated.
export class RealUnitComplianceDtoMapper {
  // --- CUSTOMER --- //

  static toCustomerListDto(userData: UserData): RealUnitCustomerListDto {
    return {
      id: userData.id,
      kycStatus: userData.kycStatus,
      kycLevel: userData.kycLevel,
      accountType: userData.accountType,
      mail: userData.mail,
      name: RealUnitComplianceDtoMapper.resolveName(userData),
    };
  }

  static toCustomerDetailDto(userData: UserData, slices: RealUnitDossierSlices): RealUnitCustomerDetailDto {
    return {
      id: userData.id,
      created: userData.created,
      accountType: userData.accountType,
      mail: userData.mail,
      firstname: userData.firstname,
      surname: userData.surname,
      verifiedName: userData.verifiedName,
      street: userData.street,
      houseNumber: userData.houseNumber,
      zip: userData.zip,
      location: userData.location,
      country: toCountryDto(userData.country),
      nationality: toCountryDto(userData.nationality),
      language: toLanguageDto(userData.language),
      birthday: userData.birthday,
      phone: userData.phone,
      organization: toOrganizationDto(userData.organization),

      kycStatus: userData.kycStatus,
      kycLevel: userData.kycLevel,
      kycType: userData.kycType,
      highRisk: userData.highRisk,
      pep: userData.pep,

      checks: RealUnitComplianceDtoMapper.toChecksDto(slices),

      kycFiles: slices.kycFiles.map(RealUnitComplianceDtoMapper.toKycFileDto),
      kycSteps: slices.kycSteps.map(RealUnitComplianceDtoMapper.toKycStepDto),
      transactions: slices.transactions.map(RealUnitComplianceDtoMapper.toTransactionDto),
      bankDatas: slices.bankDatas.map(RealUnitComplianceDtoMapper.toBankDataDto),
      buyRoutes: slices.buyRoutes.map(RealUnitComplianceDtoMapper.toBuyDto),
      sellRoutes: slices.sellRoutes.map(RealUnitComplianceDtoMapper.toSellDto),
      swapRoutes: slices.swapRoutes.map(RealUnitComplianceDtoMapper.toSwapDto),
      virtualIbans: slices.virtualIbans.map(RealUnitComplianceDtoMapper.toVirtualIbanDto),
      supportIssues: slices.supportIssues.map(RealUnitComplianceDtoMapper.toSupportIssueDto),
    };
  }

  // --- MANDATORY CHECKS --- //

  // Resolves the check evidence api-side so the dashboard renders it 1:1: ident = latest Ident step (Sumsub) plus
  // the latest Identification file as downloadable evidence; nameCheck = latest Dilisense NAME_CHECK file. Expects
  // the already-filtered dossier slices, so only allowlisted files can ever become evidence.
  private static toChecksDto(slices: RealUnitDossierSlices): RealUnitChecksDto {
    const identStep = Util.maxObj(
      slices.kycSteps.filter((s) => s.name === KycStepName.IDENT),
      'sequenceNumber',
    );
    const identFile = RealUnitComplianceDtoMapper.latestFileOfType(slices.kycFiles, FileType.IDENTIFICATION);
    const nameCheckFile = RealUnitComplianceDtoMapper.latestFileOfType(slices.kycFiles, FileType.NAME_CHECK);

    return {
      identCheck:
        identStep || identFile
          ? {
              status: identStep?.status,
              date: identStep?.created ?? identFile?.created,
              fileUid: identFile?.uid,
              fileName: identFile?.name,
            }
          : undefined,
      nameCheck: nameCheckFile
        ? { date: nameCheckFile.created, fileUid: nameCheckFile.uid, fileName: nameCheckFile.name }
        : undefined,
    };
  }

  private static latestFileOfType(files: KycFile[], type: FileType): KycFile | undefined {
    return Util.maxObj(
      files.filter((f) => f.type === type),
      'created',
    );
  }

  // --- KYC FILES --- //

  static toKycFileDto(file: KycFile): RealUnitKycFileDto {
    return {
      uid: file.uid,
      type: file.type,
      name: file.name,
      created: file.created,
    };
  }

  // --- HELPER METHODS --- //

  private static resolveName(userData: UserData): string | undefined {
    return (
      userData.verifiedName ??
      ([userData.firstname, userData.surname, userData.organization?.name].filter(Boolean).join(' ') || undefined)
    );
  }

  // Reduced KYC step: raw `result`/`comment` and the recommendation/referral graph are structurally omitted.
  private static toKycStepDto(step: KycStep): RealUnitDossierKycStepDto {
    return {
      id: step.id,
      name: step.name,
      type: step.type,
      status: step.status,
      sequenceNumber: step.sequenceNumber,
      created: step.created,
    };
  }

  // Reduced transaction: DFX AML verdict (`amlCheck`) and reasoning (`amlReason`) are structurally omitted.
  private static toTransactionDto(tx: Transaction): RealUnitDossierTxDto {
    return {
      id: tx.id,
      uid: tx.uid,
      buyCryptoId: tx.buyCrypto?.id,
      buyFiatId: tx.buyFiat?.id,
      bankDataId: tx.buyCrypto?.bankData?.id ?? tx.buyFiat?.bankData?.id,
      type: tx.type,
      sourceType: tx.sourceType,
      inputAmount: tx.buyCrypto?.inputAmount ?? tx.buyFiat?.inputAmount,
      inputAsset: tx.buyCrypto?.inputAsset ?? tx.buyFiat?.inputAsset,
      inputTxId: tx.buyCrypto?.cryptoInput?.inTxId ?? tx.buyFiat?.cryptoInput?.inTxId,
      outputAmount: tx.buyCrypto?.outputAmount ?? tx.buyFiat?.outputAmount,
      outputAsset: tx.buyCrypto?.outputAsset?.name ?? tx.buyFiat?.outputAsset?.name,
      amountInChf: tx.amountInChf,
      amountInEur: tx.buyCrypto?.amountInEur ?? tx.buyFiat?.amountInEur,
      chargebackDate:
        tx.buyCrypto?.chargebackDate ??
        tx.buyFiat?.chargebackDate ??
        tx.bankTxReturn?.chargebackDate ??
        tx.bankTxRepeat?.chargebackDate,
      isCompleted: !!tx.completionDate,
      created: tx.created,
    };
  }

  // Reduced bank data: `comment` and the cross-customer `alternatives` list are structurally omitted.
  private static toBankDataDto(bankData: BankData): RealUnitDossierBankDataDto {
    return {
      id: bankData.id,
      iban: bankData.iban,
      name: bankData.name,
      type: bankData.type,
      status: bankData.status,
      approved: bankData.approved,
      manualApproved: bankData.manualApproved,
      active: bankData.active,
      created: bankData.created,
    };
  }

  private static toBuyDto(buy: Buy): BuySupportInfo {
    const address = buy.user?.address;
    return {
      id: buy.id,
      iban: buy.iban,
      bankUsage: buy.bankUsage,
      assetName: buy.asset?.name,
      blockchain: buy.asset?.blockchain,
      targetAddress: address,
      targetAddressExplorerUrl:
        buy.asset?.blockchain && address ? addressExplorerUrl(buy.asset.blockchain, address) : undefined,
      volume: buy.volume,
      active: buy.active,
      created: buy.created,
    };
  }

  private static toSellDto(sell: Sell): SellSupportInfo {
    const depositBlockchains = sell.deposit?.blockchainList;
    return {
      id: sell.id,
      iban: sell.iban,
      fiatName: sell.fiat?.name,
      depositAddress: sell.deposit?.address,
      depositBlockchains,
      depositAddressExplorerUrl:
        depositBlockchains?.length === 1 && sell.deposit?.address
          ? addressExplorerUrl(depositBlockchains[0], sell.deposit.address)
          : undefined,
      volume: sell.annualVolume,
      active: sell.active,
      created: sell.created,
    };
  }

  private static toSwapDto(swap: Swap): SwapSupportInfo {
    const depositBlockchains = swap.deposit?.blockchainList;
    return {
      id: swap.id,
      assetName: swap.asset?.name,
      blockchain: swap.asset?.blockchain,
      depositAddress: swap.deposit?.address,
      depositAddressExplorerUrl:
        depositBlockchains?.length === 1 && swap.deposit?.address
          ? addressExplorerUrl(depositBlockchains[0], swap.deposit.address)
          : undefined,
      volume: swap.volume,
      annualVolume: swap.annualVolume,
      active: swap.active,
      created: swap.created,
    };
  }

  private static toVirtualIbanDto(viban: VirtualIban): VirtualIbanSupportInfo {
    return {
      id: viban.id,
      iban: viban.iban,
      bban: viban.bban,
      currency: viban.currency?.name,
      bank: viban.bank?.name,
      status: viban.status,
      active: viban.active,
      label: viban.label,
      buyId: viban.buy?.id,
      reservedUntil: viban.reservedUntil,
      activatedAt: viban.activatedAt,
      deactivatedAt: viban.deactivatedAt,
      created: viban.created,
    };
  }

  // Reduced support issue: the `limitRequest` DFX AML/compliance assessment and the nested `transaction.amlCheck`
  // DFX AML verdict are structurally omitted.
  private static toSupportIssueDto(issue: SupportIssue): RealUnitDossierSupportIssueDto {
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
          }
        : undefined,
      created: issue.created,
    };
  }
}
