import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as IbanTools from 'ibantools';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { BankDataRepository } from 'src/subdomains/generic/user/models/bank-data/bank-data.repository';
import { CreateBankDataDto } from 'src/subdomains/generic/user/models/bank-data/dto/create-bank-data.dto';
import { UserData, UserDataStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataRepository } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { In, IsNull, Not } from 'typeorm';
import { BankData, BankDataType, BankDataVerificationError } from './bank-data.entity';
import { UpdateBankDataDto } from './dto/update-bank-data.dto';

@Injectable()
export class BankDataService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly specialAccountService: SpecialExternalAccountService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async checkAndSetActive() {
    if (DisabledProcess(Process.BANK_DATA_VERIFICATION)) return;
    await this.bankDataVerification();
  }

  async bankDataVerification(): Promise<void> {
    const entities = await this.bankDataRepo.find({
      where: { active: IsNull(), type: Not(In([BankDataType.IDENT, BankDataType.USER])), comment: IsNull() },
      relations: { userData: true },
    });

    for (const entity of entities) {
      const existing = await this.bankDataRepo.findOne({
        where: { iban: entity.iban, active: true },
        relations: { userData: true },
      });

      const errors = this.getBankDataVerificationErrors(entity, existing);

      if (errors.length === 0) {
        if (!existing) {
          await this.bankDataRepo.update(...entity.activate());
        } else if (existing.type === BankDataType.BANK_IN || entity.type !== BankDataType.BANK_IN) {
          await this.bankDataRepo.update(...entity.deactivate(BankDataVerificationError.ALREADY_ACTIVE_EXISTS));
        } else {
          const existingError = [...(existing.comment?.split(';') ?? []), BankDataVerificationError.NEW_BANK_IN_ACTIVE];

          await this.bankDataRepo.update(...existing.deactivate(existingError.join(';')));
          await this.bankDataRepo.update(...entity.activate());
        }
      } else {
        if (existing.type === BankDataType.BANK_IN) errors.push(BankDataVerificationError.ALREADY_ACTIVE_EXISTS);

        await this.bankDataRepo.update(...entity.deactivate(errors.join(';')));
      }
    }
  }

  private getBankDataVerificationErrors(entity: BankData, existingActive?: BankData): BankDataVerificationError[] {
    const errors = [];

    if (!entity.userData.verifiedName) errors.push(BankDataVerificationError.VERIFIED_NAME_MISSING);
    else if (!entity.name) errors.push(BankDataVerificationError.NAME_MISSING);
    else if (Util.isSameName(entity.name, entity.userData.verifiedName))
      errors.push(BankDataVerificationError.VERIFIED_NAME_NOT_MATCHING);

    if (existingActive && entity.userData.id !== existingActive.userData.id)
      errors.push(BankDataVerificationError.USER_DATA_NOT_MATCHING);

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

  async getBankDataWithIban(iban: string, userDataId?: number): Promise<BankData> {
    if (!iban) return undefined;
    return this.bankDataRepo
      .find({
        where: { iban, userData: { id: userDataId } },
        relations: ['userData'],
      })
      .then((b) => b.filter((b) => b.active)[0] ?? b[0]);
  }

  async getBankDatasForUser(userDataId: number): Promise<BankData[]> {
    return this.bankDataRepo.findBy([
      { userData: { id: userDataId }, active: true },
      { userData: { id: userDataId }, active: IsNull() },
    ]);
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

    const existing = await this.bankDataRepo.exist({
      where: [
        { iban, active: true },
        { iban, active: IsNull() },
      ],
    });
    if (existing) throw new ConflictException('IBAN already exists');

    const bankData = this.bankDataRepo.create({
      userData: { id: userDataId },
      iban,
      active: null,
      type: BankDataType.USER,
    });
    await this.bankDataRepo.save(bankData);
  }
}
