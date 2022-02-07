import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityRepository, Not, Repository, getManager } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { User, UserStatus } from './user.entity';
import { WalletRepository } from 'src/user/models/wallet/wallet.repository';
import { CountryService } from 'src/shared/models/country/country.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { AccountType } from '../userData/account-type.enum';
import { Config } from 'src/config/config';

@EntityRepository(User)
export class UserRepository extends Repository<User> {
  userRepository: any;
  async createUser(
    createUserDto: CreateUserDto,
    languageService: LanguageService,
    countryService: CountryService,
    fiatService: FiatService,
  ): Promise<User> {
    let countryObject = null;
    let languageObject = null;
    let currencyObject = null;
    let walletObject = null;

    if (!(createUserDto.address.length == 34 || createUserDto.address.length == 42)) {
      throw new BadRequestException('address length does not match');
    }

    if (createUserDto.country) {
      countryObject = await countryService.getCountry(createUserDto.country);

      createUserDto.country = countryObject.id;
    } else {
      delete createUserDto.country;
    }

    if (createUserDto.wallet) {
      walletObject = await getManager().getCustomRepository(WalletRepository).getWallet(createUserDto.wallet);

      createUserDto.wallet = walletObject.id;
    } else {
      walletObject = await getManager().getCustomRepository(WalletRepository).getWallet(1);

      createUserDto.wallet = walletObject.id;
    }

    if (createUserDto.language) {
      languageObject = await languageService.getLanguage(createUserDto.language);

      createUserDto.language = languageObject.id;
    } else {
      languageObject = await languageService.getLanguage(Config.defaultLanguage);

      createUserDto.language = languageObject.id;
    }

    if (createUserDto.currency) {
      currencyObject = await fiatService.getFiat(createUserDto.currency.id);

      createUserDto.currency = currencyObject.id;
    } else {
      currencyObject = await fiatService.getFiatByName(Config.defaultCurrency);

      createUserDto.currency = currencyObject.id;
    }

    const user = this.create(createUserDto);

    const refVar = String((await this.find()).length + 1001).padStart(6, '0');

    user.ref = refVar.substr(0, 3) + '-' + refVar.substr(3, 3);
    const refUser = await this.findOne({ ref: createUserDto.usedRef });

    if (user.ref == createUserDto.usedRef || !refUser) user.usedRef = '000-000';

    if (user.accountType === AccountType.PERSONAL) {
      user.organizationName = null;
      user.organizationStreet = null;
      user.organizationHouseNumber = null;
      user.organizationLocation = null;
      user.organizationZip = null;
      user.organizationCountry = null;
    }

    try {
      await this.save(user);

      createUserDto.country = countryObject;
      createUserDto.language = languageObject;
      delete user.ref;
    } catch (error) {
      throw new ConflictException(error.message);
    }

    return user;
  }

  async getAllUser(): Promise<any> {
    try {
      return await this.find({ relations: ['userData', 'wallet'] });
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getUserInternal(addressString: string): Promise<User> {
    return this.findOne({ address: addressString });
  }

  async getRefCount(ref: string): Promise<number> {
    return this.count({ usedRef: ref });
  }

  async getRefCountActive(ref: string): Promise<number> {
    return this.count({ usedRef: ref, status: Not(UserStatus.NA) });
  }

  async updateUser(
    oldUser: User,
    newUser: UpdateUserDto,
    languageService: LanguageService,
    countryService: CountryService,
    fiatService: FiatService,
  ): Promise<any> {
    const currentUser = await this.findOne(oldUser.id);
    if (!currentUser) throw new NotFoundException('No matching user for id found');
    const currentUserData = (await this.findOne({ where: { id: currentUser.id }, relations: ['userData'] })).userData;

    const refUser = await this.findOne({ ref: newUser.usedRef });

    if (currentUser.ref == newUser.usedRef || (!refUser && newUser.usedRef) || newUser.usedRef === null) {
      newUser.usedRef = '000-000';
    } else {
      if (refUser) {
        const refUserData = (await this.findOne({ where: { id: refUser.id }, relations: ['userData'] })).userData;
        if (refUserData && currentUserData) {
          if (refUserData.id == currentUserData.id) newUser.usedRef = '000-000';
        }
      }
    }

    let countryObject = null;
    let languageObject = null;
    let currencyObject = null;

    if (newUser.country) {
      countryObject = await countryService.getCountry(newUser.country);

      newUser.country = countryObject;
    }

    if (newUser.language) {
      languageObject = await languageService.getLanguage(newUser.language);

      newUser.language = languageObject;
    } else {
      languageObject = await languageService.getLanguage(Config.defaultLanguage);

      newUser.language = languageObject;
    }

    if (newUser.currency) {
      currencyObject = await fiatService.getFiat(newUser.currency.id);

      newUser.currency = currencyObject.id;
    } else {
      currencyObject = await fiatService.getFiatByName(Config.defaultCurrency);

      newUser.currency = currencyObject.id;
    }

    newUser.id = currentUser.id;

    if (newUser.accountType === AccountType.PERSONAL) {
      newUser.organizationName = null;
      newUser.organizationStreet = null;
      newUser.organizationHouseNumber = null;
      newUser.organizationLocation = null;
      newUser.organizationZip = null;
      newUser.organizationCountry = null;
    }

    await this.save(newUser);

    return await this.findOne(currentUser.id);
  }

  async updateRole(user: UpdateRoleDto): Promise<any> {
    try {
      const currentUser = await this.findOne({ id: user.id });

      if (!currentUser) throw new NotFoundException('No matching user for id found');

      currentUser.role = user.role;

      await this.save(currentUser);

      return await this.findOne({ id: user.id });
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }
}
