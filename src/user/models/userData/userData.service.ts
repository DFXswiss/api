import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { UserDataRepository } from './userData.repository';
import { KycInProgress, KycState, UserData } from './userData.entity';
import { BankDataRepository } from 'src/user/models/bank-data/bank-data.repository';
import { User } from '../user/user.entity';
import { CountryService } from 'src/shared/models/country/country.service';
import { Not } from 'typeorm';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { KycService } from 'src/user/services/kyc/kyc.service';
import { LanguageService } from 'src/shared/models/language/language.service';

@Injectable()
export class UserDataService {
  constructor(
    private readonly userDataRepo: UserDataRepository,
    private readonly bankDataRepo: BankDataRepository,
    private readonly countryService: CountryService,
    private readonly languageService: LanguageService,
    private readonly kycService: KycService,
  ) {}

  async getUserDataForUser(userId: number): Promise<UserData> {
    return this.userDataRepo
      .createQueryBuilder('userData')
      .innerJoinAndSelect('userData.users', 'user')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .where('user.id = :id', { id: userId })
      .getOne();
  }

  async createUserData(user: User): Promise<UserData> {
    return await this.userDataRepo.save({ users: [user] });
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
    }

    return await this.userDataRepo.save({ ...userData, ...dto });
  }

  async updateUserSettings(user: UserData, dto: UpdateUserDto): Promise<UserData> {
    // check language
    if (dto.language) {
      const language = await this.languageService.getLanguage(dto.language.id);
      if (!language) throw new BadRequestException('Language not found');
    }

    // update spider
    if ((dto.phone && dto.phone != user.phone) || (dto.mail && dto.mail != user.mail)) {
      await this.kycService.updateCustomer(user.id, {
        telephones: [dto.phone?.replace('+', '').split(' ').join('')],
        emails: [dto.mail],
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
}
