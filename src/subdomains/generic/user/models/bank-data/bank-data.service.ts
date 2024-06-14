import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as IbanTools from 'ibantools';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BankDataRepository } from 'src/subdomains/generic/user/models/bank-data/bank-data.repository';
import { CreateBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/create-bank-data.dto';
import { UserData, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { In, IsNull, Not } from 'typeorm';
import { AccountMergeService } from '../account-merge/account-merge.service';
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
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async checkAndSetActive() {
    if (DisabledProcess(Process.BANK_DATA_VERIFICATION)) return;
    await this.checkUnverifiedBankDatas();
  }

  async checkUnverifiedBankDatas(): Promise<void> {
    const entities = await this.bankDataRepo.find({
      where: [
        { active: false, type: Not(In([BankDataType.IDENT, BankDataType.USER])), comment: IsNull() },
        { active: IsNull(), type: Not(In([BankDataType.IDENT, BankDataType.USER])), comment: IsNull() },
      ],
      relations: { userData: true },
    });

    for (const entity of entities) {
      await this.verifyBankData(entity);
    }
  }

  async verifyBankData(entity: BankData): Promise<void> {
    if ([BankDataType.IDENT, BankDataType.USER].includes(entity.type)) return;
    try {
      const existing = await this.bankDataRepo.findOne({
        where: { iban: entity.iban, active: true },
        relations: { userData: true },
      });

      if (!existing && !entity.userData.verifiedName)
        await this.userDataRepo.update(...entity.userData.setVerifiedName(entity.name));

      const errors = this.getBankDataVerificationErrors(entity, existing);

      if (errors.length === 0) {
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

    userData.bankDatas.push(bankData);
    return userData;
  }

  async updateBankData(id: number, dto: UpdateBankDataDto): Promise<BankData> {
    const bankData = await this.bankDataRepo.findOneBy({ id });
    if (!bankData) throw new NotFoundException('Bank data not found');

    if (dto.active) {
      const activeBankData = await this.bankDataRepo.findOneBy({
        id: Not(bankData.id),
        iban: bankData.iban,
        active: true,
      });
      if (activeBankData) throw new BadRequestException('Active bankData with same iban found');
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

  async getBankDataWithIban(iban: string, userDataId?: number): Promise<BankData> {
    if (!iban) return undefined;
    return this.bankDataRepo
      .find({
        where: { iban, userData: { id: userDataId } },
        relations: { userData: true },
      })
      .then((b) => b.filter((b) => b.active)[0] ?? b[0]);
  }

  async getBankDatasForUser(userDataId: number): Promise<BankData[]> {
    return this.bankDataRepo.find({
      where: [
        { userData: { id: userDataId }, active: true },
        { userData: { id: userDataId }, active: IsNull() },
      ],
      relations: { userData: true },
    });
  }

  async getAllBankDatasForUser(userDataId: number): Promise<BankData[]> {
    return this.bankDataRepo.find({ where: { userData: { id: userDataId } }, relations: { userData: true } });
  }

  async getIbansForUser(userDataId: number): Promise<string[]> {
    const bankDatas = await this.getBankDatasForUser(userDataId);

    return Array.from(
      new Set(bankDatas.map((b) => b.iban.split(';')[0]).filter((b) => IbanTools.validateIBAN(b).valid)),
    );
  }

  async createIbanForUser(userDataId: number, iban: string): Promise<void> {
    const multiIbans = await this.specialAccountService.getMultiAccountIbans();
    if (multiIbans.includes(iban)) throw new BadRequestException('Multi-account IBANs not allowed');

    const existing = await this.bankDataRepo.findOne({
      where: [
        { iban, active: true },
        { iban, active: IsNull() },
      ],
      relations: { userData: true },
    });
    if (existing) {
      const userData = await this.userDataRepo.findOneBy({ id: userDataId });
      if (userData.id === existing.userData.id) return;

      if (userData.verifiedName || userData.verifiedName !== existing.userData.verifiedName)
        throw new ForbiddenException('IBAN already in use');

      await this.accountMergeService.sendMergeRequest(existing.userData, userData);
      throw new ConflictException('IBAN already exists');
    }

    const bankData = this.bankDataRepo.create({
      userData: { id: userDataId },
      iban,
      active: null,
      type: BankDataType.USER,
    });
    await this.bankDataRepo.save(bankData);
  }
}
