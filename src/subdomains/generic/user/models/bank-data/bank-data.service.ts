import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import * as IbanTools from 'ibantools';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { NameCheckService } from 'src/subdomains/generic/kyc/services/name-check.service';
import { BankDataRepository } from 'src/subdomains/generic/user/models/bank-data/bank-data.repository';
import { CreateBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/create-bank-data.dto';
import { KycType, UserData, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { CreateBankAccountDto } from 'src/subdomains/supporting/bank/bank-account/dto/create-bank-account.dto';
import { UpdateBankAccountDto } from 'src/subdomains/supporting/bank/bank-account/dto/update-bank-account.dto';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { FindOptionsRelations, FindOptionsWhere, IsNull, Not } from 'typeorm';
import { MergeReason } from '../account-merge/account-merge.entity';
import { AccountMergeService } from '../account-merge/account-merge.service';
import { AccountType } from '../user-data/account-type.enum';
import { BankData, BankDataType, BankDataVerificationError } from './bank-data.entity';
import { UpdateBankDataDto } from './dto/update-bank-data.dto';

@Injectable()
export class BankDataService {
  private readonly logger = new DfxLogger(BankDataService);

  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly specialAccountService: SpecialExternalAccountService,
    private readonly accountMergeService: AccountMergeService,
    private readonly nameCheckService: NameCheckService,
    private readonly fiatService: FiatService,
    private readonly countryService: CountryService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.BANK_DATA_VERIFICATION, timeout: 1800 })
  async checkAndSetActive() {
    await this.checkUnverifiedBankDatas();
  }

  async checkUnverifiedBankDatas(): Promise<void> {
    const search: FindOptionsWhere<BankData> = {
      type: Not(BankDataType.USER),
      comment: IsNull(),
    };
    const entities = await this.bankDataRepo.find({
      where: [
        { ...search, approved: false },
        { ...search, approved: IsNull() },
      ],
      relations: { userData: { kycSteps: true } },
    });

    for (const entity of entities) {
      await this.verifyBankData(entity);
    }
  }

  async verifyBankData(entity: BankData): Promise<void> {
    try {
      if (
        !entity.userData.verifiedName &&
        (entity.userData.accountType === AccountType.PERSONAL || entity.type === BankDataType.BANK_IN)
      )
        await this.userDataRepo.update(...entity.userData.setVerifiedName(entity.name));

      if (entity.type === BankDataType.USER) return;

      if ([BankDataType.IDENT, BankDataType.NAME_CHECK].includes(entity.type)) {
        if (
          entity.userData.accountType !== AccountType.PERSONAL &&
          entity.userData.hasCompletedStep(KycStepName.COMMERCIAL_REGISTER)
        ) {
          await this.nameCheckService.closeAndRefreshRiskStatus(entity);
          await this.bankDataRepo.update(entity.id, { comment: 'Pass' });
        }

        return;
      }

      const existing = await this.bankDataRepo.findOne({
        where: { id: Not(entity.id), iban: entity.iban, approved: true },
        relations: { userData: true },
      });

      const errors = this.getBankDataVerificationErrors(entity, existing);

      if (
        errors.length === 0 ||
        (errors.length === 1 &&
          errors.includes(BankDataVerificationError.VERIFIED_NAME_MISSING) &&
          (!existing || Util.isSameName(entity.name, existing.name)))
      ) {
        if (!entity.userData.verifiedName)
          await this.userDataRepo.update(...entity.userData.setVerifiedName(entity.name));

        if (existing) {
          const existingError = [...(existing.comment?.split(';') ?? []), BankDataVerificationError.NEW_BANK_IN_ACTIVE];
          await this.bankDataRepo.update(...existing.forbid(existingError.join(';')));
        }

        await this.bankDataRepo.update(...entity.allow());
      } else {
        await this.bankDataRepo.update(...entity.forbid(errors.join(';')));
      }
    } catch (e) {
      this.logger.error(`Failed to verify bankData ${entity.id}:`, e);
    }
  }

  private getBankDataVerificationErrors(entity: BankData, existingActive?: BankData): BankDataVerificationError[] {
    const errors = [];

    if (!entity.userData.verifiedName) errors.push(BankDataVerificationError.VERIFIED_NAME_MISSING);
    else if (!entity.name) errors.push(BankDataVerificationError.NAME_MISSING);
    else if (!Util.isSameName(entity.name, entity.userData.verifiedName))
      errors.push(BankDataVerificationError.VERIFIED_NAME_NOT_MATCHING);

    if (existingActive) {
      if (entity.userData.id !== existingActive.userData.id)
        errors.push(BankDataVerificationError.USER_DATA_NOT_MATCHING);
      if (existingActive.type === BankDataType.BANK_IN || entity.type !== BankDataType.BANK_IN)
        errors.push(BankDataVerificationError.ALREADY_ACTIVE_EXISTS);
    }

    return errors;
  }

  async addBankData(userDataId: number, dto: CreateBankDataDto): Promise<UserData> {
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: { bankDatas: true } });
    if (!userData) throw new NotFoundException('User data not found');
    if (userData.status === UserDataStatus.MERGED) throw new BadRequestException('User data is merged');

    return this.createVerifyBankData(userData, dto);
  }

  async createVerifyBankData(userData: UserData, dto: CreateBankDataDto): Promise<UserData> {
    const bankData = await this.createBankDataInternal(userData, dto);

    if (!DisabledProcess(Process.BANK_DATA_VERIFICATION)) await this.verifyBankData(bankData);

    // update updated time in user data
    await this.userDataRepo.setNewUpdateTime(userData.id);

    userData.bankDatas?.push(bankData);
    return userData;
  }

  async createBankDataInternal(userData: UserData, dto: CreateBankDataDto): Promise<BankData> {
    const bankData = this.bankDataRepo.create({ ...dto, userData });
    return this.bankDataRepo.save(bankData);
  }

  async updateBankData(id: number, dto: UpdateBankDataDto): Promise<BankData> {
    const bankData = await this.bankDataRepo.findOneBy({ id });
    if (!bankData) throw new NotFoundException('Bank data not found');

    return this.updateBankDataInternal(bankData, dto);
  }

  async updateBankDataInternal(bankData: BankData, dto: UpdateBankDataDto): Promise<BankData> {
    if (dto.approved) {
      const activeBankData = await this.bankDataRepo.findOneBy({
        id: Not(bankData.id),
        iban: bankData.iban,
        approved: true,
      });
      if (activeBankData) throw new BadRequestException('Active bankData with same iban found');
    }

    if (dto.preferredCurrency) {
      dto.preferredCurrency = await this.fiatService.getFiat(dto.preferredCurrency.id);
      if (!dto.preferredCurrency) throw new NotFoundException('Preferred currency not found');
    }

    if (bankData.type !== BankDataType.USER) {
      dto.label = null;
      dto.preferredCurrency = null;
    }

    return this.bankDataRepo.saveWithUniqueDefault({ ...bankData, ...dto });
  }

  async getBankData(id: number): Promise<BankData> {
    return this.bankDataRepo.findOne({ where: { id }, relations: { userData: true } });
  }

  async getBankDataByKey(key: string, value: any): Promise<BankData> {
    return this.bankDataRepo
      .createQueryBuilder('bankData')
      .select('bankData')
      .leftJoinAndSelect('bankData.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .where(`${key.includes('.') ? key : `bankData.${key}`} = :param`, { param: value })
      .getOne();
  }

  async getVerifiedBankDataWithIban(
    iban: string,
    userDataId?: number,
    relations: FindOptionsRelations<BankData> = { userData: true },
    filterTypeUser = true,
  ): Promise<BankData> {
    if (!iban) return undefined;
    return this.bankDataRepo
      .find({
        where: { iban, userData: { id: userDataId }, type: filterTypeUser ? Not(BankDataType.USER) : undefined },
        relations,
      })
      .then((b) => b.filter((b) => b.approved)[0] ?? b[0]);
  }

  async existsUserBankDataWithIban(iban: string): Promise<boolean> {
    return this.bankDataRepo.existsBy({ iban, type: BankDataType.USER });
  }

  async getValidBankDatasForUser(userDataId: number, ibansOnly = true): Promise<BankData[]> {
    return this.bankDataRepo
      .find({
        where: [
          { userData: { id: userDataId }, approved: true },
          { userData: { id: userDataId }, approved: IsNull() },
        ],
        relations: { userData: true },
      })
      .then((l) => (ibansOnly ? l.filter((b) => IbanTools.validateIBAN(b.iban).valid) : l));
  }

  async getAllBankDatasForUser(userDataId: number): Promise<BankData[]> {
    return this.bankDataRepo.find({ where: { userData: { id: userDataId } }, relations: { userData: true } });
  }

  async updateUserBankData(id: number, userDataId: number, dto: UpdateBankAccountDto): Promise<BankData> {
    const entity = await this.bankDataRepo.findOne({
      where: { id },
      relations: { userData: true },
    });
    if (!entity) throw new NotFoundException('Bank account not found');
    if (entity.userData.id !== userDataId) throw new BadRequestException('You can only update your own bank account');

    if (dto.active === false) {
      await this.bankDataRepo
        .createQueryBuilder()
        .update('bank_data')
        .set({ active: false, default: false })
        .where('bank_data.userDataId = :userDataId', { userDataId })
        .andWhere('bank_data.id != :id', { id: entity.id })
        .andWhere('bank_data.iban = :iban', { iban: entity.iban })
        .execute();

      return this.updateBankDataInternal(entity, dto);
    }

    const bankData =
      entity.type === BankDataType.USER
        ? entity
        : (await this.bankDataRepo.findOne({
            where: { userData: { id: userDataId }, iban: entity.iban },
            relations: { userData: true },
          })) ?? (await this.createBankDataInternal(entity.userData, { iban: entity.iban, type: BankDataType.USER }));

    return this.updateBankDataInternal(bankData, dto);
  }

  async createIbanForUser(
    userDataId: number,
    dto: CreateBankAccountDto,
    sendMergeRequest = true,
    type?: BankDataType,
  ): Promise<BankData> {
    const multiIbans = await this.specialAccountService.getMultiAccountIbans();
    if (multiIbans.includes(dto.iban)) throw new BadRequestException('Multi-account IBANs not allowed');

    if (!(await this.isValidIbanCountry(dto.iban)))
      throw new BadRequestException('IBAN country is currently not supported');

    const userData = await this.userDataRepo.findOneBy({ id: userDataId });
    if (userData.status === UserDataStatus.KYC_ONLY)
      throw new ForbiddenException('You cannot add an IBAN to a kycOnly account');

    const existing = await this.bankDataRepo
      .find({
        where: [
          { iban: dto.iban, approved: true, type },
          { iban: dto.iban, approved: IsNull(), type },
        ],
        relations: { userData: true },
      })
      .then((b) => b.find((b) => b.userData.id === userDataId) ?? b[0]);

    if (existing) {
      if (userData.id === existing.userData.id) {
        if (!existing.active) await this.bankDataRepo.update(...existing.activate(dto));
        return existing;
      }

      if (sendMergeRequest && existing.userData.mail)
        await this.accountMergeService.sendMergeRequest(existing.userData, userData, MergeReason.IBAN);
    }

    if (dto.preferredCurrency) {
      dto.preferredCurrency = await this.fiatService.getFiat(dto.preferredCurrency.id);
      if (!dto.preferredCurrency) throw new NotFoundException('Preferred currency not found');
    }

    await this.bankAccountService.getOrCreateBankAccountInternal(dto.iban);

    const bankData = this.bankDataRepo.create({
      userData: { id: userDataId },
      iban: dto.iban,
      approved: null,
      type: BankDataType.USER,
      label: dto.label,
      preferredCurrency: dto.preferredCurrency,
      default: dto.default,
    });

    return this.bankDataRepo.saveWithUniqueDefault(bankData);
  }

  private async isValidIbanCountry(iban: string, kycType = KycType.DFX): Promise<boolean> {
    const ibanCountry = await this.countryService.getCountryWithSymbol(iban.substring(0, 2));

    return ibanCountry.isEnabled(kycType);
  }
}
