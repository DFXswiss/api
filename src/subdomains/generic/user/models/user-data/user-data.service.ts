import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import JSZip from 'jszip';
import { Config } from 'src/config/config';
import { CreateAccount } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { HistoryFilter, HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import {
  DefaultPaymentLinkConfig,
  PaymentLinkConfig,
} from 'src/subdomains/core/payment-link/entities/payment-link.config';
import { KycPersonalData } from 'src/subdomains/generic/kyc/dto/input/kyc-data.dto';
import { KycError } from 'src/subdomains/generic/kyc/dto/kyc-error.enum';
import { MergedDto } from 'src/subdomains/generic/kyc/dto/output/kyc-merged.dto';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycLogType, KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { KycNotificationService } from 'src/subdomains/generic/kyc/services/kyc-notification.service';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { TfaLevel, TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';
import { MailContext } from 'src/subdomains/supporting/notification/enums';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { transliterate } from 'transliteration';
import { Equal, FindOptionsRelations, In, IsNull, Not } from 'typeorm';
import { WebhookService } from '../../services/webhook/webhook.service';
import { MergeReason } from '../account-merge/account-merge.entity';
import { AccountMergeService } from '../account-merge/account-merge.service';
import { BankDataVerificationError } from '../bank-data/bank-data.entity';
import { BankDataService } from '../bank-data/bank-data.service';
import { OrganizationDto } from '../organization/dto/organization.dto';
import { OrganizationService } from '../organization/organization.service';
import { ApiKeyDto } from '../user/dto/api-key.dto';
import { UpdateUserDto, UpdateUserMailDto } from '../user/dto/update-user.dto';
import { UserNameDto } from '../user/dto/user-name.dto';
import { UpdateMailStatus } from '../user/dto/verify-mail.dto';
import { UserRepository } from '../user/user.repository';
import { AccountType } from './account-type.enum';
import { CreateUserDataDto } from './dto/create-user-data.dto';
import { UpdateUserDataDto } from './dto/update-user-data.dto';
import { KycIdentificationType } from './kyc-identification-type.enum';
import { UserDataNotificationService } from './user-data-notification.service';
import { UserData } from './user-data.entity';
import { KycLevel, UserDataStatus } from './user-data.enum';
import { UserDataRepository } from './user-data.repository';

export const MergedPrefix = 'Merged into ';

interface SecretCacheEntry {
  secret: string;
  mail: string;
  expiryDate: Date;
}

@Injectable()
export class UserDataService {
  private readonly logger = new DfxLogger(UserDataService);

  private readonly secretCache: Map<number, SecretCacheEntry> = new Map();

  constructor(
    private readonly repos: RepositoryFactory,
    private readonly userDataRepo: UserDataRepository,
    private readonly userRepo: UserRepository,
    private readonly countryService: CountryService,
    private readonly languageService: LanguageService,
    private readonly fiatService: FiatService,
    private readonly settingService: SettingService,
    private readonly kycNotificationService: KycNotificationService,
    private readonly kycLogService: KycLogService,
    private readonly userDataNotificationService: UserDataNotificationService,
    @Inject(forwardRef(() => AccountMergeService))
    private readonly mergeService: AccountMergeService,
    private readonly specialExternalBankAccountService: SpecialExternalAccountService,
    private readonly siftService: SiftService,
    private readonly webhookService: WebhookService,
    private readonly documentService: KycDocumentService,
    @Inject(forwardRef(() => KycAdminService))
    private readonly kycAdminService: KycAdminService,
    private readonly organizationService: OrganizationService,
    private readonly tfaService: TfaService,
    @Inject(forwardRef(() => TransactionService))
    private readonly transactionService: TransactionService,
    @Inject(forwardRef(() => BankDataService))
    private readonly bankDataService: BankDataService,
    @Inject(forwardRef(() => KycService))
    private readonly kycService: KycService,
    private readonly ipLogService: IpLogService,
  ) {}

  // --- GETTERS --- //
  async getUserDataByUser(userId: number): Promise<UserData> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .leftJoinAndSelect('userData.users', 'user')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('user.wallet', 'wallet')
      .where('user.id = :id', { id: userId })
      .getOne();
  }

  async getUserData(
    userDataId: number,
    relations?: FindOptionsRelations<UserData>,
    useCachedValues = false,
  ): Promise<UserData> {
    const request = { where: { id: userDataId }, relations };
    return useCachedValues
      ? this.userDataRepo.findOneCached(JSON.stringify(request), request)
      : this.userDataRepo.findOne(request);
  }

  async getByKycHashOrThrow(kycHash: string, relations?: FindOptionsRelations<UserData>): Promise<UserData> {
    if (!Config.formats.kycHash.test(kycHash)) throw new UnauthorizedException('Invalid KYC hash');

    let user = await this.userDataRepo.findOne({ where: { kycHash: Equal(kycHash) }, relations });
    if (!user) throw new NotFoundException('User not found');

    if (user.status === UserDataStatus.MERGED) {
      user = await this.getMasterUser(user);
      if (user) {
        const payload: MergedDto = {
          error: 'Unauthorized',
          message: 'User is merged',
          statusCode: 401,
          switchToCode: user.kycHash,
        };
        throw new UnauthorizedException(payload);
      } else {
        throw new BadRequestException('User is merged');
      }
    }

    return user;
  }

  async getDifferentUserWithSameIdentDoc(userDataId: number, identDocumentId: string): Promise<UserData> {
    return this.userDataRepo.findOneBy({ id: Not(userDataId), status: Not(UserDataStatus.MERGED), identDocumentId });
  }

  private async getMasterUser(user: UserData): Promise<UserData | undefined> {
    const masterUserId = +user.firstname.replace(MergedPrefix, '');
    if (!isNaN(masterUserId)) return this.getUserData(masterUserId);
  }

  async getUsersByMail(
    mail: string,
    onlyValidUser = true,
    relations: FindOptionsRelations<UserData> = { users: true, wallet: true },
  ): Promise<UserData[]> {
    return this.userDataRepo.find({
      where: {
        mail,
        status: onlyValidUser
          ? In([UserDataStatus.ACTIVE, UserDataStatus.NA, UserDataStatus.KYC_ONLY, UserDataStatus.DEACTIVATED])
          : undefined,
      },
      relations,
    });
  }

  async getUsersByName(name: string): Promise<UserData[]> {
    const where = { status: Not(UserDataStatus.MERGED) };
    const wheres = [
      { ...where, firstname: Util.contains(name) },
      { ...where, surname: Util.contains(name) },
      { ...where, verifiedName: Util.contains(name) },
      { ...where, organization: { name: Util.contains(name) } },
    ];

    const nameParts = name.split(' ');
    const first = nameParts.shift();
    const last = nameParts.pop();

    if (last)
      wheres.push({
        ...where,
        firstname: Util.contains(first),
        surname: Util.contains([...nameParts, last].join(' ')),
      });
    if (nameParts.length)
      wheres.push({
        ...where,
        firstname: Util.contains([first, ...nameParts].join(' ')),
        surname: Util.contains(last),
      });

    return this.userDataRepo.find({ where: wheres });
  }

  async getUsersByPhone(phone: string): Promise<UserData[]> {
    return this.userDataRepo.findBy({ phone });
  }

  async getUserDatasWithKycFile(): Promise<UserData[]> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .select(['userData.id', 'userData.kycFileId', 'userData.amlAccountType', 'userData.verifiedName'])
      .where('userData.kycFileId > 0')
      .orderBy('userData.kycFileId', 'ASC')
      .getMany();
  }

  async getUserDataByKey(key: string, value: any): Promise<UserData> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .select('userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.verifiedCountry', 'verifiedCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `userData.${key}`} = :param`, { param: value })
      .getOne();
  }

  // --- CREATE / UPDATE ---
  async createUserData(dto: CreateUserDataDto): Promise<UserData> {
    const userData = this.userDataRepo.create({
      ...dto,
      language: dto.language ?? (await this.languageService.getLanguageBySymbol(Config.defaults.language)),
      currency: dto.currency ?? (await this.fiatService.getFiatByName(Config.defaults.currency)),
      kycHash: randomUUID().toUpperCase(),
      kycSteps: [],
    });

    await this.loadRelationsAndVerify(userData, dto);

    return this.userDataRepo.save(userData);
  }

  async updateUserData(userDataId: number, dto: UpdateUserDataDto): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({
      where: { id: userDataId },
      relations: { users: { wallet: true }, kycSteps: true, wallet: true },
    });
    if (!userData) throw new NotFoundException('User data not found');

    dto = await this.loadRelationsAndVerify({ id: userData.id, ...dto }, dto);

    if (dto.bankTransactionVerification === CheckStatus.PASS) {
      // cancel a pending video ident, if ident is completed
      const identCompleted = userData.hasCompletedStep(KycStepName.IDENT);
      const pendingVideo = userData.getPendingStepWith(KycStepName.IDENT, KycStepType.VIDEO);
      const pendingSumSubVideo = userData.getPendingStepWith(KycStepName.IDENT, KycStepType.SUMSUB_VIDEO);

      if (identCompleted) {
        if (pendingVideo) {
          await this.kycAdminService.updateKycStepInternal(pendingVideo.cancel());
        }
        if (pendingSumSubVideo) {
          await this.kycAdminService.updateKycStepInternal(pendingSumSubVideo.cancel());
        }
      }
    }

    if (userData.kycLevel >= KycLevel.LEVEL_50 || dto.kycLevel >= KycLevel.LEVEL_50) {
      for (const user of userData.users) {
        await this.userRepo.setUserRef(user, dto.kycLevel ?? userData.kycLevel);
      }
    }

    // Columns are not updatable
    if (userData.letterSentDate) dto.letterSentDate = userData.letterSentDate;
    if (userData.verifiedName && dto.verifiedName !== null) dto.verifiedName = userData.verifiedName;

    const kycChanged = dto.kycLevel && dto.kycLevel !== userData.kycLevel;

    Object.assign(userData, dto);

    if ([AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP].includes(dto.accountType)) {
      const organizationData: OrganizationDto = {
        name: dto.organizationName,
        street: dto.organizationStreet,
        location: dto.organizationLocation,
        houseNumber: dto.organizationHouseNumber,
        zip: dto.organizationZip,
        country: dto.organizationCountry,
        allBeneficialOwnersName: dto.allBeneficialOwnersName,
        allBeneficialOwnersDomicile: dto.allBeneficialOwnersDomicile,
        accountOpenerAuthorization: dto.accountOpenerAuthorization,
        complexOrgStructure: dto.complexOrgStructure,
        accountOpener: dto.accountOpener,
        legalEntity: dto.legalEntity,
        signatoryPower: dto.signatoryPower,
      };

      if (!userData.organization) {
        userData.organization = await this.organizationService.createOrganization(organizationData);
      } else if (userData.organization) {
        await this.organizationService.updateOrganizationInternal(userData.organization, organizationData);
      }
    }

    await this.userDataRepo.save(userData);

    if (kycChanged) await this.kycNotificationService.kycChanged(userData, userData.kycLevel);

    return userData;
  }

  async downloadUserData(userDataIds: number[]): Promise<Buffer> {
    let count = userDataIds.length;
    const zip = new JSZip();
    const downloadTargets = Config.fileDownloadConfig.reverse();
    let errorLog = '';

    for (const userDataId of userDataIds.reverse()) {
      const userData = await this.getUserData(userDataId, { kycSteps: true });

      if (!userData?.verifiedName) {
        errorLog += !userData
          ? `Error: UserData ${userDataId} not found\n`
          : `Error: UserData ${userDataId} has no verifiedName\n`;
        continue;
      }

      const baseFolderName = `${(count--).toString().padStart(2, '0')}_${String(userDataId)}_${
        userData.verifiedName
      }`.replace(/\./g, '');
      const parentFolder = zip.folder(baseFolderName);

      if (!parentFolder) {
        errorLog += `Error: Failed to create folder for UserData ${userDataId}\n`;
        continue;
      }

      const applicableTargets = downloadTargets.filter((t) => !t.ignore?.(userData));

      const allPrefixes = Array.from(
        new Set(applicableTargets.map((t) => t.files.map((f) => f.prefixes(userData))).flat(2)),
      );
      const allFiles = await this.documentService.listFilesByPrefixes(allPrefixes);

      for (const { id, name, files: fileConfig } of applicableTargets) {
        const folderName = `${id.toString().padStart(2, '0')}_${name}`;
        const subFolder = parentFolder.folder(folderName);

        if (!subFolder) {
          errorLog += `Error: Failed to create folder '${folderName}' for UserData ${userDataId}\n`;
          continue;
        }

        for (const { name: fileName, fileTypes, prefixes, filter, handleFileNotFound, sort } of fileConfig) {
          const files = allFiles
            .filter((f) => prefixes(userData).some((p) => f.path.startsWith(p)))
            .filter((f) => !fileTypes || fileTypes.some((t) => f.contentType.startsWith(t)))
            .filter((f) => !filter || filter(f, userData));

          if (!files.length) {
            if (handleFileNotFound && handleFileNotFound(subFolder, userData)) continue;
            errorLog += `Error: File missing for folder '${folderName}' for UserData ${userDataId}\n`;
            continue;
          }

          const selectedFile = files.reduce((l, c) => (sort ? sort(l, c) : l.updated > c.updated ? l : c));

          try {
            const fileData = await this.documentService.downloadFile(
              selectedFile.category,
              userDataId,
              selectedFile.type,
              selectedFile.name,
            );
            const filePath = `${userDataId}-${fileName?.(selectedFile) ?? name}.${selectedFile.name.split('.').pop()}`;
            subFolder.file(filePath, fileData.data);
          } catch {
            errorLog += `Error: Failed to download file '${selectedFile.name}' for UserData ${userDataId}\n`;
          }
        }
      }
    }

    if (errorLog) zip.file('error_log.txt', errorLog);

    return zip.generateAsync({ type: 'nodebuffer' });
  }

  async updateUserDataInternal(userData: UserData, dto: Partial<UserData>): Promise<UserData> {
    await this.loadRelationsAndVerify({ id: userData.id, ...dto }, dto);

    if (dto.kycLevel && dto.kycLevel < userData.kycLevel) dto.kycLevel = userData.kycLevel;

    await this.userDataRepo.update(userData.id, dto);

    const kycChanged = dto.kycLevel && dto.kycLevel !== userData.kycLevel;

    Object.assign(userData, dto);

    if (kycChanged) await this.kycNotificationService.kycChanged(userData, userData.kycLevel);

    if (
      [AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP].includes(dto.accountType ?? userData.accountType) &&
      userData.organization
    )
      await this.organizationService.updateOrganizationInternal(userData.organization, {
        name: dto.organizationName,
        street: dto.organizationStreet,
        location: dto.organizationLocation,
        houseNumber: dto.organizationHouseNumber,
        zip: dto.organizationZip,
        country: dto.organizationCountry,
        allBeneficialOwnersName: dto.allBeneficialOwnersName,
        allBeneficialOwnersDomicile: dto.allBeneficialOwnersDomicile,
        accountOpenerAuthorization: dto.accountOpenerAuthorization,
        complexOrgStructure: dto.complexOrgStructure,
        accountOpener: dto.accountOpener,
        legalEntity: dto.legalEntity,
        signatoryPower: dto.signatoryPower,
      });

    if (userData.users && (userData.kycLevel >= KycLevel.LEVEL_50 || dto.kycLevel >= KycLevel.LEVEL_50)) {
      for (const user of userData.users) {
        await this.userRepo.setUserRef(user, dto.kycLevel ?? userData.kycLevel);
      }
    }

    return userData;
  }

  async getLastKycFileId(): Promise<number> {
    return this.userDataRepo.findOne({ where: {}, order: { kycFileId: 'DESC' } }).then((u) => u.kycFileId);
  }

  async updatePersonalData(userData: UserData, data: KycPersonalData): Promise<UserData> {
    const update: Partial<UserData> = {
      accountType: data.accountType,
      firstname: transliterate(data.firstName),
      surname: transliterate(data.lastName),
      street: transliterate(data.address.street),
      houseNumber: transliterate(data.address.houseNumber),
      location: transliterate(data.address.city),
      zip: transliterate(data.address.zip),
      country: data.address.country,
      phone: data.phone,
      organizationName: data.organizationName,
      organizationStreet: data.organizationAddress?.street,
      organizationHouseNumber: data.organizationAddress?.houseNumber,
      organizationLocation: data.organizationAddress?.city,
      organizationZip: data.organizationAddress?.zip,
      organizationCountry: data.organizationAddress?.country,
      tradeApprovalDate: data.accountType === AccountType.ORGANIZATION ? new Date() : undefined,
    };

    const isPersonalAccount =
      (update.accountType ?? userData.accountType ?? AccountType.PERSONAL) === AccountType.PERSONAL;

    // check countries
    const [country, organizationCountry] = await Promise.all([
      this.countryService.getCountry(update.country?.id ?? userData.country?.id),
      this.countryService.getCountry(update.organizationCountry?.id ?? userData.organizationCountry?.id),
    ]);
    if (!country || (!isPersonalAccount && !organizationCountry)) throw new BadRequestException('Country not found');
    if (
      !country.isEnabled(userData.kycType) ||
      (!isPersonalAccount && !organizationCountry.isEnabled(userData.kycType))
    )
      throw new BadRequestException(`Country not allowed for ${userData.kycType}`);

    if (isPersonalAccount) {
      update.organizationName = null;
      update.organizationStreet = null;
      update.organizationHouseNumber = null;
      update.organizationLocation = null;
      update.organizationZip = null;
      update.organizationCountry = null;
    } else {
      const organizationData = {
        name: update.organizationName,
        street: update.organizationStreet,
        location: update.organizationLocation,
        houseNumber: update.organizationHouseNumber,
        zip: update.organizationZip,
        country: organizationCountry,
      };

      update.organization = !userData.organization
        ? await this.organizationService.createOrganization(organizationData)
        : await this.organizationService.updateOrganizationInternal(userData.organization, organizationData);
    }

    for (const user of userData.users) {
      this.siftService.updateAccount({
        $user_id: user.id.toString(),
        $time: Date.now(),
        $user_email: update.mail,
        $name: `${update.firstname} ${update.surname}`,
        $phone: update.phone,
        $billing_address: {
          $name: `${update.firstname} ${update.surname}`,
          $address_1: `${update.street} ${update.houseNumber}`,
          $city: update.location,
          $phone: update.phone,
          $country: country.symbol,
          $zipcode: update.zip,
        },
      });
    }

    if (update.mail) await this.kycLogService.createMailChangeLog(userData, userData.mail, update.mail);

    await this.userDataRepo.update(userData.id, update);

    return Object.assign(userData, update);
  }

  async updateTotpSecret(user: UserData, secret: string): Promise<void> {
    await this.userDataRepo.update(user.id, { totpSecret: secret });
  }

  async updatePaymentLinksConfig(user: UserData, dto: Partial<PaymentLinkConfig>): Promise<void> {
    const mergedConfig = { ...JSON.parse(user.paymentLinksConfig || '{}'), ...dto };
    const customConfig = Util.removeDefaultFields(mergedConfig, DefaultPaymentLinkConfig);
    const paymentLinksConfig = Object.keys(customConfig).length === 0 ? null : JSON.stringify(customConfig);

    await this.userDataRepo.update(user.id, { paymentLinksConfig });
    user.paymentLinksConfig = paymentLinksConfig;
  }

  async updateUserName(userData: UserData, dto: UserNameDto) {
    for (const user of userData.users) {
      this.siftService.updateAccount({
        $user_id: user.id.toString(),
        $time: Date.now(),
        $name: `${dto.firstName} ${dto.lastName}`,
      } as CreateAccount);
    }

    await this.userDataRepo.update(userData.id, { firstname: dto.firstName, surname: dto.lastName });
  }

  async deactivateUserData(userData: UserData): Promise<void> {
    await this.userDataRepo.update(...userData.deactivateUserData());
    await this.kycAdminService.resetKyc(userData, KycError.USER_DATA_DEACTIVATED);
    await this.kycLogService.createLogInternal(
      userData,
      KycLogType.KYC,
      `UserData deactivated on ${userData.deactivationDate.toISOString()}`,
    );
    await this.kycService.createKycLevelLog(userData, userData.kycLevel);
    await this.userDataNotificationService.deactivateAccountMail(userData);
  }

  async refreshLastNameCheckDate(userData: UserData): Promise<void> {
    await this.userDataRepo.update(...userData.refreshLastCheckedTimestamp());
  }

  // --- MAIL UPDATE --- //

  async updateUserMail(userData: UserData, dto: UpdateUserMailDto, ip: string): Promise<UpdateMailStatus> {
    if (userData.mail == null) {
      await this.trySetUserMail(userData, dto.mail);
      return UpdateMailStatus.Ok;
    }

    await this.checkMail(userData, dto.mail);

    await this.tfaService.checkVerification(userData, ip, TfaLevel.BASIC);

    // mail verification
    const secret = Util.randomIdString(6);
    const codeExpiryMinutes = 30;

    this.secretCache.set(userData.id, {
      secret,
      mail: dto.mail,
      expiryDate: Util.minutesAfter(codeExpiryMinutes),
    });

    // send mail
    await this.tfaService.sendVerificationMail(
      { ...userData, mail: dto.mail } as UserData,
      secret,
      codeExpiryMinutes,
      MailContext.EMAIL_VERIFICATION,
    );

    return UpdateMailStatus.Accepted;
  }

  async verifyUserMail(userData: UserData, token: string): Promise<UserData> {
    const cacheEntry = this.secretCache.get(userData.id);
    if (token !== cacheEntry?.secret) throw new ForbiddenException('Invalid or expired mail verification token');
    this.secretCache.delete(userData.id);

    await this.checkMail(userData, cacheEntry.mail);

    return this.doUpdateUserMail(userData, cacheEntry.mail);
  }

  async trySetUserMail(userData: UserData, mail: string): Promise<UserData> {
    await this.checkMail(userData, mail);

    return this.doUpdateUserMail(userData, mail);
  }

  async checkMail(userData: UserData, mail: string): Promise<void> {
    const mailUsers = await this.getUsersByMail(mail).then((l) => AccountMergeService.masterFirst(l));
    const conflictUsers = mailUsers.filter((u) => u.id !== userData.id);
    if (!conflictUsers.length) return;

    // check if current user is the master
    if (mailUsers[0].id === userData.id) return;

    let errorMessage = 'Account already exists';

    // check if merge possible
    const mergeUser = conflictUsers.find((u) => u.isMergePossibleWith(userData));
    if (mergeUser) {
      const mergeRequested = await this.mergeService.sendMergeRequest(mergeUser, userData, MergeReason.MAIL);
      if (mergeRequested) errorMessage += ' - account merge request sent';
    }

    throw new ConflictException(errorMessage);
  }

  private async doUpdateUserMail(userData: UserData, mail: string): Promise<UserData> {
    await this.userDataRepo.update(userData.id, { mail });
    Object.assign(userData, { mail });

    // update Sift
    const updateSiftAccount: CreateAccount = {
      $time: Date.now(),
      $user_email: mail,
    };

    for (const user of userData.users) {
      updateSiftAccount.$user_id = user.id.toString();
      this.siftService.updateAccount(updateSiftAccount);
    }

    await this.kycLogService.createMailChangeLog(userData, userData.mail, mail);

    try {
      await this.kycService.initializeProcess(userData);
    } catch (e) {
      this.logger.error(`Failed to initialize KYC process for account ${userData.id}:`, e);
    }

    return userData;
  }

  // --- SETTINGS UPDATE --- //
  async updateUserSettings(userData: UserData, dto: UpdateUserDto): Promise<UserData> {
    // check phone KYC is already started
    if (userData.kycLevel != KycLevel.LEVEL_0 && (dto.phone === null || dto.phone === ''))
      throw new BadRequestException('KYC already started, user data deletion not allowed');

    // check language
    if (dto.language) {
      dto.language = await this.languageService.getLanguage(dto.language.id);
      if (!dto.language) throw new BadRequestException('Language not found');
    }

    // check currency
    if (dto.currency) {
      dto.currency = await this.fiatService.getFiat(dto.currency.id);
      if (!dto.currency) throw new BadRequestException('Currency not found');
    }

    const phoneChanged = dto.phone && dto.phone !== userData.phone;

    const updateSiftAccount: CreateAccount = { $time: Date.now() };

    if (phoneChanged) updateSiftAccount.$phone = dto.phone;

    if (phoneChanged) {
      for (const user of userData.users) {
        updateSiftAccount.$user_id = user.id.toString();
        this.siftService.updateAccount(updateSiftAccount);
      }
    }

    await this.userDataRepo.update(...userData.setUserDataSettings(dto));

    return userData;
  }

  // --- KYC --- //
  async getIdentMethod(userData: UserData): Promise<KycStepType> {
    const defaultIdent =
      userData.accountType === AccountType.ORGANIZATION
        ? await this.settingService.get('defaultIdentMethodOrganization', KycStepType.SUMSUB_AUTO)
        : await this.settingService.get('defaultIdentMethod', KycStepType.SUMSUB_AUTO);
    const customIdent = await this.customIdentMethod(userData.id);

    return customIdent ?? (defaultIdent as KycStepType);
  }

  private async customIdentMethod(userDataId: number): Promise<KycStepType | undefined> {
    const userWithCustomMethod = await this.userRepo.findOne({
      where: {
        userData: { id: userDataId },
        wallet: { identMethod: Not(IsNull()) },
      },
      relations: { wallet: true },
    });

    return userWithCustomMethod?.wallet.identMethod;
  }

  async triggerVideoIdent(userData: UserData): Promise<void> {
    await this.kycAdminService.triggerVideoIdentInternal(userData);
  }

  async setCheckIpRisk(ip: string): Promise<void> {
    const userDataIdsWithIpRisk = await this.ipLogService.getUserDataIdsWith(ip);
    if (userDataIdsWithIpRisk.length) await this.userDataRepo.update(userDataIdsWithIpRisk, { hasIpRisk: true });
  }

  // --- API KEY --- //
  async createApiKey(userDataId: number, filter: HistoryFilter): Promise<ApiKeyDto> {
    const userData = await this.userDataRepo.findOneBy({ id: userDataId });
    if (!userData) throw new BadRequestException('User not found');
    if (userData.apiKeyCT) throw new ConflictException('API key already exists');

    userData.apiKeyCT = ApiKeyService.createKey(userData.id);
    userData.apiFilterCT = ApiKeyService.getFilterCode(filter);

    await this.userDataRepo.update(userDataId, { apiKeyCT: userData.apiKeyCT, apiFilterCT: userData.apiFilterCT });

    const secret = ApiKeyService.getSecret(userData);

    return { key: userData.apiKeyCT, secret };
  }

  async deleteApiKey(userDataId: number): Promise<void> {
    await this.userDataRepo.update(userDataId, { apiKeyCT: null });
  }

  async updateApiFilter(userDataId: number, filter: HistoryFilter): Promise<HistoryFilterKey[]> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId } });
    if (!userData) throw new BadRequestException('UserData not found');

    userData.apiFilterCT = ApiKeyService.getFilterCode(filter);
    await this.userDataRepo.update(userDataId, { apiFilterCT: userData.apiFilterCT });

    return ApiKeyService.getFilterArray(userData.apiFilterCT);
  }

  async checkApiKey(key: string, sign: string, timestamp: string): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({ where: { apiKeyCT: key }, relations: { users: true } });
    if (!userData) throw new NotFoundException('API key not found');
    if (!ApiKeyService.isValidSign(userData, sign, timestamp)) throw new ForbiddenException('Invalid API key/sign');

    return userData;
  }

  // --- HELPER METHODS --- //
  private async loadRelationsAndVerify(
    userData: Partial<UserData> | UserData,
    dto: UpdateUserDataDto | CreateUserDataDto,
  ): Promise<Partial<UserData>> {
    if (dto.countryId || dto.country) {
      userData.country = await this.countryService.getCountry(dto.countryId ?? dto.country.id);
      if (!userData.country) throw new BadRequestException('Country not found');
    }

    if (dto.nationality) {
      userData.nationality = await this.countryService.getCountry(dto.nationality.id);
      if (!userData.nationality) throw new BadRequestException('Nationality not found');
    }

    if (dto.organizationCountryId) {
      userData.organizationCountry = await this.countryService.getCountry(dto.organizationCountryId);
      if (!userData.organizationCountry) throw new BadRequestException('Country not found');
    }

    if (dto.verifiedCountry) {
      userData.verifiedCountry = await this.countryService.getCountry(dto.verifiedCountry.id);
      if (!userData.verifiedCountry) throw new BadRequestException('VerifiedCountry not found');
    }

    if (dto.language) {
      userData.language = await this.languageService.getLanguage(dto.language.id);
      if (!userData.language) throw new BadRequestException('Language not found');
    }

    if (dto.currency) {
      userData.currency = await this.fiatService.getFiat(dto.currency.id);
      if (!userData.currency) throw new BadRequestException('Currency not found');
    }

    if (dto.accountOpener) {
      userData.accountOpener = await this.userDataRepo.findOneBy({ id: dto.accountOpener.id });
      if (!userData.accountOpener) throw new BadRequestException('AccountOpener not found');
    }

    if (dto.verifiedName) {
      const multiAccountIbans = await this.specialExternalBankAccountService.getMultiAccounts();
      if (multiAccountIbans.some((m) => dto.verifiedName.includes(m.name)))
        throw new BadRequestException('VerifiedName includes a multiAccount');
    }

    if (dto.kycFileId) {
      const userWithSameFileId = await this.userDataRepo.findOneBy({ kycFileId: dto.kycFileId });
      if (userWithSameFileId) throw new ConflictException('A user with this KYC file ID already exists');

      Object.assign(userData, { kycFileId: dto.kycFileId });
    }

    if (dto.nationality || dto.identDocumentId) {
      const existing = await this.userDataRepo.findOneBy({
        nationality: { id: dto.nationality?.id ?? userData.nationality?.id },
        identDocumentId: dto.identDocumentId ?? userData.identDocumentId,
      });
      if (existing && (dto.identDocumentId || userData.identDocumentId) && userData.id !== existing.id)
        throw new ConflictException('A user with the same nationality and ident document ID already exists');
    }

    return userData;
  }

  // --- KYC CLIENTS --- //

  async addKycClient(userData: UserData, walletId: number): Promise<void> {
    if (userData.kycClientList.includes(walletId)) return;

    await this.userDataRepo.update(...userData.addKycClient(walletId));
  }

  async removeKycClient(userData: UserData, walletId: number): Promise<void> {
    if (!userData.kycClientList.includes(walletId)) return;

    await this.userDataRepo.update(...userData.removeKycClient(walletId));
  }

  // --- FEES --- //

  async addFee(userData: UserData, feeId: number): Promise<void> {
    if (userData.individualFeeList?.includes(feeId)) return;

    await this.userDataRepo.update(...userData.addFee(feeId));
  }

  async removeFee(userData: UserData, feeId: number): Promise<void> {
    if (!userData.individualFeeList?.includes(feeId)) throw new BadRequestException('Discount code already removed');

    await this.userDataRepo.update(...userData.removeFee(feeId));
  }

  // --- VOLUMES --- //
  @DfxCron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    await this.userDataRepo.update(
      [{ annualBuyVolume: Not(0) }, { annualSellVolume: Not(0) }, { annualCryptoVolume: Not(0) }],
      { annualBuyVolume: 0, annualSellVolume: 0, annualCryptoVolume: 0 },
    );
  }

  @DfxCron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async resetMonthlyVolumes(): Promise<void> {
    await this.userDataRepo.update(
      [{ monthlyBuyVolume: Not(0) }, { monthlySellVolume: Not(0) }, { monthlyCryptoVolume: Not(0) }],
      { monthlyBuyVolume: 0, monthlySellVolume: 0, monthlyCryptoVolume: 0 },
    );
  }

  async updateVolumes(userDataId: number): Promise<void> {
    const volumes = await this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyVolume)', 'buyVolume')
      .addSelect('SUM(annualBuyVolume)', 'annualBuyVolume')
      .addSelect('SUM(monthlyBuyVolume)', 'monthlyBuyVolume')
      .addSelect('SUM(sellVolume)', 'sellVolume')
      .addSelect('SUM(annualSellVolume)', 'annualSellVolume')
      .addSelect('SUM(monthlySellVolume)', 'monthlySellVolume')
      .addSelect('SUM(cryptoVolume)', 'cryptoVolume')
      .addSelect('SUM(annualCryptoVolume)', 'annualCryptoVolume')
      .addSelect('SUM(monthlyCryptoVolume)', 'monthlyCryptoVolume')

      .where('userDataId = :id', { id: userDataId })
      .getRawOne<{
        buyVolume: number;
        annualBuyVolume: number;
        monthlyBuyVolume: number;
        sellVolume: number;
        annualSellVolume: number;
        monthlySellVolume: number;
        cryptoVolume: number;
        annualCryptoVolume: number;
        monthlyCryptoVolume: number;
      }>();

    await this.userDataRepo.update(userDataId, {
      buyVolume: Util.round(volumes.buyVolume, Config.defaultVolumeDecimal),
      annualBuyVolume: Util.round(volumes.annualBuyVolume, Config.defaultVolumeDecimal),
      monthlyBuyVolume: Util.round(volumes.monthlyBuyVolume, Config.defaultVolumeDecimal),
      sellVolume: Util.round(volumes.sellVolume, Config.defaultVolumeDecimal),
      annualSellVolume: Util.round(volumes.annualSellVolume, Config.defaultVolumeDecimal),
      monthlySellVolume: Util.round(volumes.monthlySellVolume, Config.defaultVolumeDecimal),
      cryptoVolume: Util.round(volumes.cryptoVolume, Config.defaultVolumeDecimal),
      annualCryptoVolume: Util.round(volumes.annualCryptoVolume, Config.defaultVolumeDecimal),
      monthlyCryptoVolume: Util.round(volumes.monthlyCryptoVolume, Config.defaultVolumeDecimal),
    });
  }

  // --- MERGING --- //
  async mergeUserData(masterId: number, slaveId: number, mail?: string, notifyUser = false): Promise<void> {
    if (masterId === slaveId) throw new BadRequestException('Merging with oneself is not possible');

    this.logger.info(`Merge between ${masterId} and ${slaveId} started`);

    const master = await this.userDataRepo.findOne({
      where: { id: masterId },
      relations: {
        accountRelations: true,
        relatedAccountRelations: true,
        supportIssues: true,
        wallet: true,
        language: true,
      },
      loadEagerRelations: false,
    });
    master.transactions = await this.transactionService.getAllTransactionsForUserData(masterId);
    master.users = await this.userRepo.find({
      where: { userData: { id: masterId } },
      relations: { userData: true, wallet: true },
    });
    master.bankDatas = await this.bankDataService.getAllBankDatasForUser(masterId);
    master.kycSteps = await this.kycAdminService.getKycSteps(masterId);

    const slave = await this.userDataRepo.findOne({
      where: { id: slaveId },
      relations: {
        accountRelations: true,
        relatedAccountRelations: true,
        supportIssues: true,
        wallet: true,
        language: true,
      },
      loadEagerRelations: false,
    });
    slave.transactions = await this.transactionService.getAllTransactionsForUserData(slaveId);
    slave.users = await this.userRepo.find({
      where: { userData: { id: slaveId } },
      relations: { userData: true, wallet: true },
    });
    slave.bankDatas = await this.bankDataService.getAllBankDatasForUser(slaveId);
    slave.kycSteps = await this.kycAdminService.getKycSteps(slaveId);

    master.checkIfMergePossibleWith(slave);

    if (slave.kycLevel > master.kycLevel) throw new BadRequestException('Slave kycLevel can not be higher as master');

    const mergedEntitiesString = [
      slave.bankDatas.length > 0 && `bank datas ${slave.bankDatas.map((b) => b.id)}`,
      slave.users.length > 0 && `users ${slave.users.map((u) => u.id)}`,
      slave.accountRelations.length > 0 && `accountRelations ${slave.accountRelations.map((a) => a.id)}`,
      slave.relatedAccountRelations.length > 0 &&
        `relatedAccountRelations ${slave.relatedAccountRelations.map((a) => a.id)}`,
      slave.kycSteps.length && `kycSteps ${slave.kycSteps.map((k) => k.id)}`,
      slave.individualFees && `individualFees ${slave.individualFees}`,
      slave.kycClients && `kycClients ${slave.kycClients}`,
      slave.supportIssues.length > 0 && `supportIssues ${slave.supportIssues.map((s) => s.id)}`,
      slave.transactions.length > 0 && `transactions ${slave.transactions.map((s) => s.id)}`,
    ]
      .filter((i) => i)
      .join(' and ');

    const log = `Merging user ${master.id} (master with mail ${master.mail}) and ${slave.id} (slave with mail ${slave.mail} and firstname ${slave.firstname}): reassigning ${mergedEntitiesString}`;
    this.logger.info(log);

    await this.updateBankTxTime(slave.id);

    // Notify user about changed mail
    if (notifyUser && slave.mail && ![slave.mail, mail].includes(master.mail))
      await this.userDataNotificationService.userDataChangedMailInfo(master, slave);

    // Adapt slave kyc step sequenceNumber
    const sequenceNumberOffset = master.kycSteps.length ? Util.minObjValue(master.kycSteps, 'sequenceNumber') - 100 : 0;
    for (const kycStep of slave.kycSteps) {
      await this.kycAdminService.updateKycStepInternal(
        kycStep.update(
          [
            ReviewStatus.IN_PROGRESS,
            ReviewStatus.MANUAL_REVIEW,
            ReviewStatus.INTERNAL_REVIEW,
            ReviewStatus.EXTERNAL_REVIEW,
            ReviewStatus.FINISHED,
            ReviewStatus.PARTIALLY_APPROVED,
            ReviewStatus.DATA_REQUESTED,
            ReviewStatus.PAUSED,
            ReviewStatus.ON_HOLD,
          ].includes(kycStep.status)
            ? ReviewStatus.CANCELED
            : undefined,
          undefined,
          undefined,
          kycStep.sequenceNumber + sequenceNumberOffset,
        ),
      );
    }

    // Adapt slave bankData in review
    for (const bankData of slave.bankDatas.filter((b) => b.isInReview)) {
      if (
        bankData.comment.includes(BankDataVerificationError.ALREADY_ACTIVE_EXISTS) &&
        master.bankDatas.some((b) => b.iban === bankData.iban && b.approved)
      )
        await this.bankDataService.updateBankDataInternal(bankData, { status: ReviewStatus.FAILED, approved: false });
    }

    // Adapt master bankData in review
    for (const bankData of master.bankDatas.filter((b) => b.isInReview)) {
      if (
        bankData.comment.includes(BankDataVerificationError.ALREADY_ACTIVE_EXISTS) &&
        slave.bankDatas.some((b) => b.iban === bankData.iban && b.approved)
      )
        await this.bankDataService.updateBankDataInternal(bankData, { status: ReviewStatus.FAILED, approved: false });
    }

    // reassign bank datas, users and userDataRelations
    master.bankDatas = master.bankDatas.concat(slave.bankDatas);
    master.users = master.users.concat(slave.users);
    master.accountRelations = master.accountRelations.concat(slave.accountRelations);
    master.relatedAccountRelations = master.relatedAccountRelations.concat(slave.relatedAccountRelations);
    master.kycSteps = master.kycSteps.concat(slave.kycSteps);
    master.supportIssues = master.supportIssues.concat(slave.supportIssues);
    master.transactions = master.transactions.concat(slave.transactions);
    slave.individualFeeList?.forEach((fee) => !master.individualFeeList?.includes(fee) && master.addFee(fee));
    slave.kycClientList.forEach((kc) => !master.kycClientList.includes(kc) && master.addKycClient(kc));

    // copy all documents
    void this.documentService
      .copyFiles(slave.id, master.id)
      .catch((e) => this.logger.critical(`Error in document copy files for master ${master.id}:`, e));

    // optional master updates
    if (master.status === UserDataStatus.KYC_ONLY && slave.users.length && slave.wallet) master.wallet = slave.wallet;
    if ([UserDataStatus.KYC_ONLY, UserDataStatus.DEACTIVATED].includes(master.status)) master.status = slave.status;
    if (!master.amlListAddedDate && slave.amlListAddedDate) {
      master.amlListAddedDate = slave.amlListAddedDate;
      master.amlListExpiredDate = slave.amlListExpiredDate;
      master.amlListReactivatedDate = slave.amlListReactivatedDate;
      master.kycFileId = slave.kycFileId;
    }
    if (
      slave.kycSteps.some((k) => (k.type === KycStepType.VIDEO || k.type === KycStepType.SUMSUB_VIDEO) && k.isCompleted)
    ) {
      master.identificationType = KycIdentificationType.VIDEO_ID;
      master.bankTransactionVerification = CheckStatus.UNNECESSARY;
    }
    if (!master.verifiedName && slave.verifiedName) master.verifiedName = slave.verifiedName;
    master.mail = mail ?? slave.mail ?? master.mail;
    if (!master.tradeApprovalDate && slave.tradeApprovalDate) master.tradeApprovalDate = slave.tradeApprovalDate;

    const pendingRecommendation = master.kycSteps.find((k) => k.name === KycStepName.RECOMMENDATION && !k.isDone);
    if (master.tradeApprovalDate && pendingRecommendation)
      await this.kycAdminService.updateKycStepInternal(pendingRecommendation.update(ReviewStatus.COMPLETED));

    // Adapt user used refs
    for (const user of master.users) {
      if (master.users.some((u) => u.ref === user.usedRef))
        await this.userRepo.update(user.id, { usedRef: Config.defaultRef });
    }

    // update slave status
    await this.userDataRepo.update(slave.id, {
      status: UserDataStatus.MERGED,
      firstname: `${MergedPrefix}${master.id}`,
      amlListAddedDate: null,
      amlListExpiredDate: null,
      amlListReactivatedDate: null,
      kycFileId: null,
    });

    await this.userDataRepo.save(master);

    // Merge Webhook
    await this.webhookService.accountChanged(master, slave);

    // KYC change Webhook
    await this.kycNotificationService.kycChanged(master);

    // update volumes
    await this.updateVolumes(masterId);
    await this.updateVolumes(slaveId);

    // activate users
    if (master.hasActiveUser || slave.status === UserDataStatus.ACTIVE) {
      await this.userDataRepo.activateUserData(master);

      for (const user of master.users) {
        if (user.isBlockedOrDeleted) continue;

        await this.userRepo.update(...user.activateUser());
        await this.userRepo.setUserRef(user, master.kycLevel);
      }
    } else if (master.users?.some((u) => u.ref)) {
      for (const user of master.users) {
        await this.userRepo.setUserRef(user, master.kycLevel);
      }
    }

    await this.kycLogService.createMergeLog(master, log);

    // Notify user about added address
    if (notifyUser) await this.userDataNotificationService.userDataAddedAddressInfo(master, slave);
  }

  private async updateBankTxTime(userDataId: number): Promise<void> {
    const txList = await this.repos.bankTx.find({
      select: ['id'],
      where: [
        { buyCrypto: { buy: { user: { userData: { id: userDataId } } } } },
        { buyFiats: { sell: { user: { userData: { id: userDataId } } } } },
      ],
      relations: { buyCrypto: { buy: { user: { userData: true } } }, buyFiats: { sell: { user: { userData: true } } } },
    });

    if (txList.length != 0)
      await this.repos.bankTx.update(
        txList.map((tx) => tx.id),
        { updated: new Date() },
      );
  }

  // --- KYC FILE STATISTICS --- //

  async getKycFileYearlyStats(startYear: number, endYear: number): Promise<Map<number, KycFileYearlyStatsData>> {
    const stats = new Map<number, KycFileYearlyStatsData>();

    // Query counts per year from database
    for (let year = startYear; year <= endYear; year++) {
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

      const [reopened, newFiles, closedDuringYear, highestFileNr] = await Promise.all([
        this.countByDateRange('amlListReactivatedDate', yearStart, yearEnd),
        this.countByDateRange('amlListAddedDate', yearStart, yearEnd),
        this.countByDateRange('amlListExpiredDate', yearStart, yearEnd),
        this.getMaxKycFileIdByDateRange('amlListAddedDate', yearStart, yearEnd),
      ]);

      stats.set(year, { reopened, newFiles, closedDuringYear, highestFileNr });
    }

    return stats;
  }

  private async countByDateRange(field: string, start: Date, end: Date): Promise<number> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .where(`userData.${field} >= :start`, { start })
      .andWhere(`userData.${field} <= :end`, { end })
      .getCount();
  }

  private async getMaxKycFileIdByDateRange(field: string, start: Date, end: Date): Promise<number> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .select('MAX(userData.kycFileId)', 'maxKycFileId')
      .where(`userData.${field} >= :start`, { start })
      .andWhere(`userData.${field} <= :end`, { end })
      .getRawOne<{ maxKycFileId: number }>()
      .then((r) => r?.maxKycFileId ?? 0);
  }
}

export interface KycFileYearlyStatsData {
  reopened: number;
  newFiles: number;
  closedDuringYear: number;
  highestFileNr: number;
}
