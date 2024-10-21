import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as IbanTools from 'ibantools';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { NameCheckService } from 'src/subdomains/generic/kyc/services/name-check.service';
import { BankDataRepository } from 'src/subdomains/generic/user/models/bank-data/bank-data.repository';
import { CreateBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/create-bank-data.dto';
import { UserData, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { CreateIbanDto } from 'src/subdomains/supporting/bank/bank-account/dto/iban.dto';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { FindOptionsWhere, In, IsNull, Not } from 'typeorm';
import { MergeReason } from '../account-merge/account-merge.entity';
import { AccountMergeService } from '../account-merge/account-merge.service';
import { AccountType } from '../user-data/account-type.enum';
import { BankData, BankDataType, BankDataVerificationError } from './bank-data.entity';
import { UpdateBankDataDto, UpdateUserBankDataDto } from './dto/update-bank-data.dto';

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
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async checkAndSetActive() {
    if (DisabledProcess(Process.BANK_DATA_VERIFICATION)) return;
    await this.checkUnverifiedBankDatas();
  }

  async checkUnverifiedBankDatas(): Promise<void> {
    const search: FindOptionsWhere<BankData> = {
      type: Not(In([BankDataType.IDENT, BankDataType.USER])),
      comment: IsNull(),
      userData: { verifiedName: Not(IsNull()) },
    };
    const entities = await this.bankDataRepo.find({
      where: [
        { ...search, approved: false },
        { ...search, approved: IsNull() },
      ],
      relations: { userData: true },
    });

    for (const entity of entities) {
      await this.verifyBankData(entity);
    }
  }

  async verifyBankData(entity: BankData): Promise<void> {
    if ([BankDataType.IDENT, BankDataType.USER].includes(entity.type)) {
      if (!entity.userData.verifiedName && entity.userData.accountType === AccountType.PERSONAL)
        await this.userDataRepo.update(...entity.userData.setVerifiedName(entity.name));

      if (entity.type === BankDataType.IDENT) await this.nameCheckService.closeAndRefreshRiskStatus(entity);

      return;
    }
    try {
      const existing = await this.bankDataRepo.findOne({
        where: { iban: entity.iban, approved: true },
        relations: { userData: true },
      });

      if (!entity.userData.verifiedName && entity.type === BankDataType.BANK_IN)
        await this.userDataRepo.update(...entity.userData.setVerifiedName(entity.name));

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
          await this.bankDataRepo.update(...existing.deactivate(existingError.join(';')));
        }

        await this.bankDataRepo.update(...entity.activate());
      } else {
        await this.bankDataRepo.update(...entity.deactivate(errors.join(';')));
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
    const userData = await this.userDataRepo.findOne({ where: { id: userDataId }, relations: ['bankDatas'] });
    if (!userData) throw new NotFoundException('User data not found');
    if (userData.status === UserDataStatus.MERGED) throw new BadRequestException('User data is merged');

    return this.createBankData(userData, dto);
  }

  async createBankData(userData: UserData, dto: CreateBankDataDto): Promise<UserData> {
    const bankData = this.bankDataRepo.create({ ...dto, userData });
    await this.bankDataRepo.save(bankData);

    if (!DisabledProcess(Process.BANK_DATA_VERIFICATION)) await this.verifyBankData(bankData);

    // update updated time in user data
    await this.userDataRepo.setNewUpdateTime(userData.id);

    userData.bankDatas?.push(bankData);
    return userData;
  }

  async updateBankData(id: number, dto: UpdateBankDataDto): Promise<BankData> {
    const bankData = await this.bankDataRepo.findOneBy({ id });
    if (!bankData) throw new NotFoundException('Bank data not found');

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

    return this.bankDataRepo.save({ ...bankData, ...dto });
  }

  async deleteBankData(id: number): Promise<void> {
    await this.bankDataRepo.delete(id);
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

  async getVerifiedBankDataWithIban(iban: string, userDataId?: number): Promise<BankData> {
    if (!iban) return undefined;
    return this.bankDataRepo
      .find({
        where: { iban, userData: { id: userDataId }, type: Not(BankDataType.USER) },
        relations: { userData: true },
      })
      .then((b) => b.filter((b) => b.approved)[0] ?? b[0]);
  }

  async getBankDatasForUser(userDataId: number): Promise<BankData[]> {
    return this.bankDataRepo.find({
      where: [
        { userData: { id: userDataId }, approved: true },
        { userData: { id: userDataId }, approved: IsNull() },
      ],
      relations: { userData: true },
    });
  }

  async getAllBankDatasForUser(userDataId: number): Promise<BankData[]> {
    return this.bankDataRepo.find({ where: { userData: { id: userDataId } }, relations: { userData: true } });
  }

  async getUserBankData(userDataId: number): Promise<BankData[]> {
    const bankDatas = await this.getBankDatasForUser(userDataId);

    return Array.from(
      new Set(
        bankDatas
          .map((b) => ({ ...b, iban: b.iban.split(';')[0] } as BankData))
          .filter((b) => IbanTools.validateIBAN(b.iban).valid),
      ),
    );
  }

  async updateUserBankData(id: number, userDataId: number, dto: UpdateUserBankDataDto): Promise<BankData> {
    const bankData = await this.bankDataRepo.findOne({ where: { id }, relations: { userData: true } });
    if (!bankData) throw new NotFoundException('Bank data not found');
    if (bankData.userData.id !== userDataId) throw new BadRequestException('You can only update your own bankData');

    return this.updateBankData(id, dto);
  }

  async createIbanForUser(
    userDataId: number,
    dto: CreateIbanDto,
    sendMergeRequest = true,
    type?: BankDataType,
  ): Promise<BankData> {
    const multiIbans = await this.specialAccountService.getMultiAccountIbans();
    if (multiIbans.includes(dto.iban)) throw new BadRequestException('Multi-account IBANs not allowed');

    const existing = await this.bankDataRepo.findOne({
      where: [
        { iban: dto.iban, approved: true, type },
        { iban: dto.iban, approved: IsNull(), type },
      ],
      relations: { userData: true },
    });
    if (existing) {
      const userData = await this.userDataRepo.findOneBy({ id: userDataId });
      if (userData.id === existing.userData.id) return;

      if (userData.verifiedName && !Util.isSameName(userData.verifiedName, existing.userData.verifiedName))
        throw new ForbiddenException('IBAN already in use');

      if (!sendMergeRequest) throw new ConflictException(`IBAN already exists: ${existing.id}`);

      const sentMergeRequest = await this.accountMergeService.sendMergeRequest(
        existing.userData,
        userData,
        MergeReason.IBAN,
        false,
      );
      throw new ConflictException(`IBAN already exists${sentMergeRequest ? ' - account merge request sent' : ''}`);
    }

    if (dto.preferredCurrency) {
      dto.preferredCurrency = await this.fiatService.getFiat(dto.preferredCurrency.id);
      if (!dto.preferredCurrency) throw new NotFoundException('Preferred currency not found');
    }

    const bankData = this.bankDataRepo.create({
      userData: { id: userDataId },
      iban: dto.iban,
      approved: null,
      type: BankDataType.USER,
      label: dto.label,
      preferredCurrency: dto.preferredCurrency,
    });

    return this.bankDataRepo.save(bankData);
  }
}
