import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-user-data.dto';
import { UserDataRepository } from './user-data.repository';
import { KycInProgress, KycState, UserData } from './user-data.entity';
import { BankDataRepository } from 'src/user/models/bank-data/bank-data.repository';
import { CountryService } from 'src/shared/models/country/country.service';
import { Not } from 'typeorm';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { LanguageService } from 'src/shared/models/language/language.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Config } from 'src/config/config';
import { ReferenceType, SpiderService } from 'src/user/services/spider/spider.service';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserRepository } from '../user/user.repository';
import { SpiderApiService } from 'src/user/services/spider/spider-api.service';
import { Util } from 'src/shared/util';

@Injectable()
export class UserDataService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly userRepo: UserRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly countryService: CountryService,
    private readonly languageService: LanguageService,
    private readonly fiatService: FiatService,
    private readonly spiderService: SpiderService,
    private readonly spiderApiService: SpiderApiService,
  ) {}

  async getUserDataByUser(userId: number): Promise<UserData> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .innerJoin('userData.users', 'user')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .where('user.id = :id', { id: userId })
      .getOne();
  }

  async getUserDataByKycHash(kycHash: string): Promise<UserData | undefined> {
    return this.userDataRepo.findOne({ kycHash });
  }

  async createUserData(): Promise<UserData> {
    const userData = await this.userDataRepo.save({
      language: await this.languageService.getLanguageBySymbol(Config.defaultLanguage),
      currency: await this.fiatService.getFiatByName(Config.defaultCurrency),
    });

    // generate KYC hash
    userData.kycHash = await this.generateKycHash(userData.id);
    await this.userDataRepo.update(userData.id, { kycHash: userData.kycHash });

    return userData;
  }

  private async generateKycHash(id: number): Promise<string> {
    for (let i = 0; i < 3; i++) {
      const kycHash = Util.createHash(id.toString() + new Date().getDate()).slice(0, 12);
      if ((await this.getUserDataByKycHash(kycHash)) == null) return kycHash;
    }

    throw new InternalServerErrorException(`Failed to generate KYC hash`);
  }

  async updateUserData(userDataId: number, dto: UpdateUserDataDto): Promise<UserData> {
    let userData = await this.userDataRepo.findOne(userDataId);
    if (!userData) throw new NotFoundException('User data not found');

    userData = await this.updateUserSettings(userData, dto);

    if (dto.countryId) {
      userData.country = await this.countryService.getCountry(dto.countryId);
      if (!userData.country) throw new BadRequestException('Country not found');
    }

    if (dto.organizationCountryId) {
      userData.organizationCountry = await this.countryService.getCountry(dto.organizationCountryId);
      if (!userData.organizationCountry) throw new BadRequestException('Country not found');
    }

    if (dto.kycStatus && !dto.kycState) {
      dto.kycState = KycState.NA;
    }

    if (dto.mainBankDataId) {
      userData.mainBankData = await this.bankDataRepo.findOne(dto.mainBankDataId);
      if (!userData.mainBankData) throw new BadRequestException('Bank data not found');
    }

    if (dto.kycFileId) {
      const userWithSameFileId = await this.userDataRepo.findOne({
        where: { id: Not(userDataId), kycFileId: dto.kycFileId },
      });
      if (userWithSameFileId) throw new ConflictException('A user with this KYC file ID already exists');

      const customerInfo = await this.spiderApiService.getCustomerInfo(userDataId);
      if (customerInfo?.contractReference == null) throw new BadRequestException('Spider KYC file reference is null');

      if (customerInfo.contractReference !== dto.kycFileId.toString())
        await this.spiderService.renameReference(
          customerInfo.contractReference,
          dto.kycFileId.toString(),
          ReferenceType.CONTRACT,
        );
    }

    return await this.userDataRepo.save({ ...userData, ...dto });
  }

  async updateUserSettings(user: UserData, dto: UpdateUserDto): Promise<UserData> {
    // check language
    if (dto.language) {
      const language = await this.languageService.getLanguage(dto.language.id);
      if (!language) throw new BadRequestException('Language not found');
    }

    // check currency
    if (dto.currency) {
      const currency = await this.fiatService.getFiat(dto.currency.id);
      if (!currency) throw new BadRequestException('Currency not found');
    }

    // update spider
    if ((dto.phone && dto.phone != user.phone) || (dto.mail && dto.mail != user.mail)) {
      await this.spiderService.updateCustomer(user.id, {
        telephones: dto.phone ? [dto.phone.replace('+', '').split(' ').join('')] : undefined,
        emails: dto.mail ? [dto.mail] : undefined,
      });

      if (KycInProgress(user.kycStatus)) {
        user.kycState = KycState.FAILED;
      }
    }

    return this.userDataRepo.save({ ...user, ...dto });
  }

  async mergeUserData(masterId: number, slaveId: number): Promise<void> {
    const [master, slave] = await Promise.all([
      this.userDataRepo.findOne({ where: { id: masterId }, relations: ['users', 'bankDatas'] }),
      this.userDataRepo.findOne({ where: { id: slaveId }, relations: ['users', 'bankDatas'] }),
    ]);

    master.bankDatas = master.bankDatas.concat(slave.bankDatas);
    master.users = master.users.concat(slave.users);
    await this.userDataRepo.save(master);
  }

  async hasRole(userDataId: number, role: UserRole): Promise<boolean> {
    return await this.userRepo.findOne({ where: { userData: { id: userDataId }, role } }).then((u) => u != null);
  }
}
