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
import { Cron, CronExpression } from '@nestjs/schedule';
import JSZip from 'jszip';
import { Config } from 'src/config/config';
import { CreateAccount } from 'src/integration/sift/dto/sift.dto';
import { SiftService } from 'src/integration/sift/services/sift.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { HistoryFilter, HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { UpdatePaymentLinkConfigDto } from 'src/subdomains/core/payment-link/dto/payment-link-config.dto';
import { KycPersonalData } from 'src/subdomains/generic/kyc/dto/input/kyc-data.dto';
import { MergedDto } from 'src/subdomains/generic/kyc/dto/output/kyc-merged.dto';
import { KycStepName, KycStepStatus, KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { KycAdminService } from 'src/subdomains/generic/kyc/services/kyc-admin.service';
import { KycLogService } from 'src/subdomains/generic/kyc/services/kyc-log.service';
import { KycNotificationService } from 'src/subdomains/generic/kyc/services/kyc-notification.service';
import { TfaLevel, TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';
import { MailContext } from 'src/subdomains/supporting/notification/enums';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { Equal, FindOptionsRelations, In, IsNull, Not } from 'typeorm';
import { WebhookService } from '../../services/webhook/webhook.service';
import { MergeReason } from '../account-merge/account-merge.entity';
import { AccountMergeService } from '../account-merge/account-merge.service';
import { ApiKeyDto } from '../user/dto/api-key.dto';
import { UpdateUserDto, UpdateUserMailDto } from '../user/dto/update-user.dto';
import { UserNameDto } from '../user/dto/user-name.dto';
import { UserRepository } from '../user/user.repository';
import { AccountType } from './account-type.enum';
import { CreateUserDataDto } from './dto/create-user-data.dto';
import { UpdateUserDataDto } from './dto/update-user-data.dto';
import { KycIdentificationType } from './kyc-identification-type.enum';
import { UserDataNotificationService } from './user-data-notification.service';
import { KycLevel, UserData, UserDataStatus } from './user-data.entity';
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
    @Inject(forwardRef(() => AccountMergeService)) private readonly mergeService: AccountMergeService,
    private readonly specialExternalBankAccountService: SpecialExternalAccountService,
    private readonly siftService: SiftService,
    private readonly webhookService: WebhookService,
    private readonly documentService: KycDocumentService,
    private readonly kycAdminService: KycAdminService,
    private readonly tfaService: TfaService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async syncWallet() {
    if (DisabledProcess(Process.USER_DATA_WALLET_SYNC)) return;

    const entities = await this.userDataRepo.find({
      where: { wallet: { id: IsNull() }, users: { id: Not(IsNull()) } },
      relations: { users: { wallet: true } },
      take: 10000,
    });

    for (const entity of entities) {
      try {
        await this.userDataRepo.update(entity.id, { wallet: entity.users[0].wallet });
      } catch (e) {
        this.logger.error(`Error in userData wallet sync: ${entity.id}`, e);
      }
    }
  }

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

  async getUserData(userDataId: number, relations?: FindOptionsRelations<UserData>): Promise<UserData> {
    return this.userDataRepo.findOne({ where: { id: userDataId }, relations });
  }

  async getByKycHashOrThrow(kycHash: string, relations?: FindOptionsRelations<UserData>): Promise<UserData> {
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

  async getUsersByMail(mail: string): Promise<UserData[]> {
    return this.userDataRepo.find({
      where: {
        mail,
        status: In([UserDataStatus.ACTIVE, UserDataStatus.NA, UserDataStatus.KYC_ONLY, UserDataStatus.DEACTIVATED]),
      },
      relations: { users: true, wallet: true },
    });
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

    await this.loadRelationsAndVerify({ id: userData.id, ...dto }, dto);

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

    // If KYC level >= 50 and DFX-approval not complete, complete it.
    if (userData.kycLevel >= KycLevel.LEVEL_50 || dto.kycLevel >= KycLevel.LEVEL_50) {
      const pendingDfxApproval = userData.getStepsWith(KycStepName.DFX_APPROVAL).find((s) => !s.isCompleted);
      if (pendingDfxApproval) await this.kycAdminService.updateKycStepInternal(pendingDfxApproval.complete());

      for (const user of userData.users) {
        await this.userRepo.setUserRef(user, dto.kycLevel ?? userData.kycLevel);
      }
    }

    // Columns are not updatable
    if (userData.letterSentDate) dto.letterSentDate = userData.letterSentDate;
    if (userData.identificationType) dto.identificationType = userData.identificationType;
    if (userData.verifiedName && dto.verifiedName !== null) dto.verifiedName = userData.verifiedName;

    const kycChanged = dto.kycLevel && dto.kycLevel !== userData.kycLevel;

    await this.userDataRepo.update(userData.id, dto);
    Object.assign(userData, dto);

    if (kycChanged) await this.kycNotificationService.kycChanged(userData, userData.kycLevel);

    return userData;
  }

  async downloadUserData(userDataIds: number[]): Promise<Buffer> {
    let count = userDataIds.length;
    const zip = new JSZip();
    const downloadTargets = Config.downloadTargets.reverse();
    let errorLog = '';

    for (const userDataId of userDataIds.reverse()) {
      const userData = await this.getUserData(userDataId);

      if (!userData?.verifiedName) {
        errorLog += !userData
          ? `Error: UserData ${userDataId} not found\n`
          : `Error: UserData ${userDataId} has no verifiedName\n`;
        continue;
      }

      const baseFolderName = `${(count--).toString().padStart(2, '0')}_${String(userDataId)}_${userData.verifiedName}`;
      const parentFolder = zip.folder(baseFolderName);

      if (!parentFolder) {
        errorLog += `Error: Failed to create folder for UserData ${userDataId}\n`;
        continue;
      }

      const allPrefixes = Array.from(new Set(downloadTargets.map((t) => t.prefixes(userData)).flat()));
      const allFiles = await this.documentService.listFilesByPrefixes(allPrefixes);

      for (const { folderName, fileTypes, prefixes, filter, handleFileNotFound } of downloadTargets) {
        const subFolder = parentFolder.folder(folderName);

        if (!subFolder) {
          errorLog += `Error: Failed to create folder '${folderName}' for UserData ${userDataId}\n`;
          continue;
        }

        const files = allFiles
          .filter((f) => prefixes(userData).some((p) => f.path.startsWith(p)))
          .filter((f) => !fileTypes || fileTypes.some((t) => f.contentType.startsWith(t)))
          .filter((f) => !filter || filter(f, userData));

        if (!files.length) {
          if (handleFileNotFound && handleFileNotFound(subFolder, userData)) continue;
          errorLog += `Error: No file found for folder '${folderName}' for UserData ${userDataId}\n`;
          continue;
        }

        const latestFile = files.reduce((l, c) => (new Date(l.updated) > new Date(c.updated) ? l : c));

        try {
          const fileData = await this.documentService.downloadFile(
            latestFile.category,
            userDataId,
            latestFile.type,
            latestFile.name,
          );
          subFolder.file(latestFile.name.replace(/\//g, '_'), fileData.data);
        } catch (error) {
          errorLog += `Error: Failed to download file '${latestFile.name}' for UserData ${userDataId}\n`;
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

    return userData;
  }

  async getLastKycFileId(): Promise<number> {
    return this.userDataRepo.findOne({ where: {}, order: { kycFileId: 'DESC' } }).then((u) => u.kycFileId);
  }

  async updatePersonalData(userData: UserData, data: KycPersonalData): Promise<UserData> {
    const update: Partial<UserData> = {
      accountType: data.accountType,
      firstname: data.firstName,
      surname: data.lastName,
      street: data.address.street,
      houseNumber: data.address.houseNumber,
      location: data.address.city,
      zip: data.address.zip,
      country: data.address.country,
      phone: data.phone,
      organizationName: data.organizationName,
      organizationStreet: data.organizationAddress?.street,
      organizationHouseNumber: data.organizationAddress?.houseNumber,
      organizationLocation: data.organizationAddress?.city,
      organizationZip: data.organizationAddress?.zip,
      organizationCountry: data.organizationAddress?.country,
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
    }

    for (const user of userData.users) {
      await this.siftService.updateAccount({
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

  async updatePaymentLinksConfig(user: UserData, dto: UpdatePaymentLinkConfigDto): Promise<void> {
    const paymentLinksConfig = JSON.stringify({
      ...JSON.parse(user.paymentLinksConfig || '{}'),
      ...dto,
    });

    await this.userDataRepo.update(user.id, { paymentLinksConfig });
    user.paymentLinksConfig = paymentLinksConfig;
  }

  async updateUserName(userData: UserData, dto: UserNameDto) {
    for (const user of userData.users) {
      await this.siftService.updateAccount({
        $user_id: user.id.toString(),
        $time: Date.now(),
        $name: `${dto.firstName} ${dto.lastName}`,
      } as CreateAccount);
    }

    await this.userDataRepo.update(userData.id, { firstname: dto.firstName, surname: dto.lastName });
  }

  async deactivateUserData(userData: UserData): Promise<void> {
    await this.userDataRepo.update(...userData.deactivateUserData());
    await this.kycAdminService.resetKyc(userData);
  }

  async refreshLastNameCheckDate(userData: UserData): Promise<void> {
    await this.userDataRepo.update(...userData.refreshLastCheckedTimestamp());
  }

  // --- MAIL UPDATE --- //

  async updateUserMail(userData: UserData, dto: UpdateUserMailDto, ip: string): Promise<void> {
    if (userData.mail == null) await this.trySetUserMail(userData, dto.mail);

    await this.checkMail(userData, dto.mail);

    await this.tfaService.checkVerification(userData, ip, TfaLevel.BASIC);

    // mail verification
    const secret = Util.randomId().toString().slice(0, 6);
    const codeExpiryMinutes = 30;

    this.secretCache.set(userData.id, {
      secret,
      mail: dto.mail,
      expiryDate: Util.minutesAfter(codeExpiryMinutes),
    });

    // send mail
    return this.tfaService.sendVerificationMail(
      { ...userData, mail: dto.mail } as UserData,
      secret,
      codeExpiryMinutes,
      MailContext.EMAIL_VERIFICATION,
    );
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
    const mailUsers = await this.getUsersByMail(mail).then((l) => this.mergeService.masterFirst(l));
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
      await this.siftService.updateAccount(updateSiftAccount);
    }

    await this.kycLogService.createMailChangeLog(userData, userData.mail, mail);

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
        await this.siftService.updateAccount(updateSiftAccount);
      }
    }

    return this.userDataRepo.save(Object.assign(userData, dto));
  }

  // --- KYC --- //
  async getIdentMethod(userData: UserData): Promise<KycStepType> {
    const defaultIdent = await this.settingService.get('defaultIdentMethod', KycStepType.AUTO);
    const customIdent = await this.customIdentMethod(userData.id);
    const isVipUser = await this.hasRole(userData.id, UserRole.VIP);

    return isVipUser ? KycStepType.SUMSUB_VIDEO : customIdent ?? (defaultIdent as KycStepType);
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
  private async hasRole(userDataId: number, role: UserRole): Promise<boolean> {
    return this.userRepo.existsBy({ userData: { id: userDataId }, role });
  }

  private async loadRelationsAndVerify(
    userData: Partial<UserData> | UserData,
    dto: UpdateUserDataDto | CreateUserDataDto,
  ): Promise<void> {
    if (dto.countryId) {
      userData.country = await this.countryService.getCountry(dto.countryId);
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
        throw new BadRequestException('VerifiedName includes a multiAccountIban');
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
    if (userData.specialCodeList?.includes(feeId)) return;

    await this.userDataRepo.update(...userData.addSpecialCode(feeId));
  }

  async removeFee(userData: UserData, feeId: number): Promise<void> {
    if (!userData.specialCodeList?.includes(feeId)) throw new BadRequestException('Discount code already removed');

    await this.userDataRepo.update(...userData.removeSpecialCode(feeId));
  }

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  @Lock()
  async resetAnnualVolumes(): Promise<void> {
    await this.userDataRepo.update({ annualBuyVolume: Not(0) }, { annualBuyVolume: 0 });
    await this.userDataRepo.update({ annualSellVolume: Not(0) }, { annualSellVolume: 0 });
  }

  async updateVolumes(userDataId: number): Promise<void> {
    const volumes = await this.userRepo
      .createQueryBuilder('user')
      .select('SUM(buyVolume)', 'buyVolume')
      .addSelect('SUM(annualBuyVolume)', 'annualBuyVolume')
      .addSelect('SUM(sellVolume)', 'sellVolume')
      .addSelect('SUM(annualSellVolume)', 'annualSellVolume')
      .addSelect('SUM(cryptoVolume)', 'cryptoVolume')
      .addSelect('SUM(annualCryptoVolume)', 'annualCryptoVolume')
      .where('userDataId = :id', { id: userDataId })
      .getRawOne<{
        buyVolume: number;
        annualBuyVolume: number;
        sellVolume: number;
        annualSellVolume: number;
        cryptoVolume: number;
        annualCryptoVolume: number;
      }>();

    await this.userDataRepo.update(userDataId, {
      buyVolume: Util.round(volumes.buyVolume, Config.defaultVolumeDecimal),
      annualBuyVolume: Util.round(volumes.annualBuyVolume, Config.defaultVolumeDecimal),
      sellVolume: Util.round(volumes.sellVolume, Config.defaultVolumeDecimal),
      annualSellVolume: Util.round(volumes.annualSellVolume, Config.defaultVolumeDecimal),
      cryptoVolume: Util.round(volumes.cryptoVolume, Config.defaultVolumeDecimal),
      annualCryptoVolume: Util.round(volumes.annualCryptoVolume, Config.defaultVolumeDecimal),
    });
  }

  // --- MERGING --- //
  async mergeUserData(masterId: number, slaveId: number, mail?: string, notifyUser = false): Promise<void> {
    if (masterId === slaveId) throw new BadRequestException('Merging with oneself is not possible');

    const [master, slave] = await Promise.all([
      this.userDataRepo.findOne({
        where: { id: masterId },
        relations: {
          users: { wallet: true },
          bankDatas: true,
          accountRelations: true,
          relatedAccountRelations: true,
          kycSteps: true,
          supportIssues: true,
          wallet: true,
        },
      }),
      this.userDataRepo.findOne({
        where: { id: slaveId },
        relations: {
          users: { wallet: true },
          bankDatas: true,
          accountRelations: true,
          relatedAccountRelations: true,
          kycSteps: true,
          supportIssues: true,
          wallet: true,
        },
      }),
    ]);
    master.checkIfMergePossibleWith(slave);

    if (slave.kycLevel > master.kycLevel) throw new BadRequestException('Slave kycLevel can not be higher as master');

    const mergedEntitiesString = [
      slave.bankDatas.length > 0 && `bank datas ${slave.bankDatas.map((b) => b.id)}`,
      slave.users.length > 0 && `users ${slave.users.map((u) => u.id)}`,
      slave.accountRelations.length > 0 && `accountRelations ${slave.accountRelations.map((a) => a.id)}`,
      slave.relatedAccountRelations.length > 0 &&
        `relatedAccountRelations ${slave.relatedAccountRelations.map((a) => a.id)}`,
      slave.kycSteps.length && `kycSteps ${slave.kycSteps.map((k) => k.id)}`,
      slave.specialCodes && `individualFees ${slave.specialCodes}`,
      slave.kycClients && `kycClients ${slave.kycClients}`,
      slave.supportIssues.length > 0 && `supportIssues ${slave.supportIssues.map((s) => s.id)}`,
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
            KycStepStatus.IN_PROGRESS,
            KycStepStatus.MANUAL_REVIEW,
            KycStepStatus.INTERNAL_REVIEW,
            KycStepStatus.EXTERNAL_REVIEW,
            KycStepStatus.FINISHED,
          ].includes(kycStep.status)
            ? KycStepStatus.CANCELED
            : undefined,
          undefined,
          kycStep.sequenceNumber + sequenceNumberOffset,
        ),
      );
    }

    // reassign bank datas, users and userDataRelations
    master.bankDatas = master.bankDatas.concat(slave.bankDatas);
    master.users = master.users.concat(slave.users);
    master.accountRelations = master.accountRelations.concat(slave.accountRelations);
    master.relatedAccountRelations = master.relatedAccountRelations.concat(slave.relatedAccountRelations);
    master.kycSteps = master.kycSteps.concat(slave.kycSteps);
    master.supportIssues = master.supportIssues.concat(slave.supportIssues);
    slave.specialCodeList?.forEach((s) => !master.specialCodeList?.includes(s) && master.addSpecialCode(s));
    slave.kycClientList.forEach((kc) => !master.kycClientList.includes(kc) && master.addKycClient(kc));

    // copy all documents
    void this.documentService
      .copyFiles(slave.id, master.id)
      .catch((e) => this.logger.critical(`Error in document copy files for master ${master.id}:`, e));

    // optional master updates
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
    master.mail = mail ?? slave.mail ?? master.mail;

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
    if (master.hasActiveUser) {
      await this.userDataRepo.activateUserData(master);

      for (const user of master.users) {
        await this.userRepo.update(...user.activateUser());
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
        { buyFiat: { sell: { user: { userData: { id: userDataId } } } } },
      ],
      relations: [
        'buyCrypto',
        'buyCrypto.buy',
        'buyCrypto.buy.user',
        'buyCrypto.buy.user.userData',
        'buyFiat',
        'buyFiat.sell',
        'buyFiat.sell.user',
        'buyFiat.sell.user.userData',
      ],
    });

    if (txList.length != 0)
      await this.repos.bankTx.update(
        txList.map((tx) => tx.id),
        { updated: new Date() },
      );
  }
}
