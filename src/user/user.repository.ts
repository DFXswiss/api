import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityRepository, In, Not, Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { User, UserRole, UserStatus } from './user.entity';
import { CountryRepository } from 'src/country/country.repository';
import { getManager } from 'typeorm';
import { UpdateStatusDto } from './dto/update-status.dto';
import { LanguageRepository } from 'src/language/language.repository';
import { WalletRepository } from 'src/wallet/wallet.repository';
import { BuyPaymentRepository } from 'src/payment/payment-buy.repository';
import { PaymentStatus } from 'src/payment/payment.entity';
import { KycStatus } from 'src/userData/userData.entity';

@EntityRepository(User)
export class UserRepository extends Repository<User> {
  async createUser(createUserDto: CreateUserDto): Promise<User> {
    let countryObject = null;
    let languageObject = null;
    let walletObject = null;

    if (!(createUserDto.address.length == 34 || createUserDto.address.length == 42)) {
      throw new BadRequestException('address length does not match');
    }

    if (createUserDto.country) {
      countryObject = await getManager().getCustomRepository(CountryRepository).getCountry(createUserDto.country);

      createUserDto.country = countryObject.id;
    } else {
      delete createUserDto.country;
    }

    if (createUserDto.wallet) {
      walletObject = await getManager().getCustomRepository(WalletRepository).getWallet(createUserDto.country);

      createUserDto.wallet = walletObject.id;
    } else {
      walletObject = await getManager().getCustomRepository(WalletRepository).getWallet(1);

      createUserDto.wallet = walletObject.id;
    }

    if (createUserDto.language) {
      languageObject = await getManager().getCustomRepository(LanguageRepository).getLanguage(createUserDto.language);

      createUserDto.language = languageObject.id;
    } else {
      delete createUserDto.language;
    }

    const user = this.create(createUserDto);

    const refVar = String((await this.find()).length + 1001).padStart(6, '0');

    user.ref = refVar.substr(0, 3) + '-' + refVar.substr(3, 3);
    const refUser = await this.findOne({ ref: createUserDto.usedRef });

    if (user.ref == createUserDto.usedRef || !refUser) user.usedRef = '000-000';

    try {
      await this.save(user);

      createUserDto.country = countryObject;
      createUserDto.language = languageObject;
      delete user.ref;
    } catch (error) {
      throw new ConflictException(error.message);
    }

    // if (
    //   user.ref == createUserDto.usedRef ||
    //   (!refUser && createUserDto.usedRef)
    // )
    //   user.ref = '-1';

    return user;
  }

  async getAllUser(): Promise<any> {
    try {
      let users = await this.find();

      for (let a = 0; a < users.length; a++) {
        users[a].wallet = await users[a].wallet;
        await users[a].userData;
      }

      return users;
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateStatus(user: UpdateStatusDto): Promise<any> {
    try {
      let currentUser = null;

      if (user.id) {
        currentUser = await this.findOne({ id: user.id });
      } else if (user.address) {
        currentUser = await this.findOne({ address: user.address });
      }

      if (!currentUser) throw new NotFoundException('No matching user for id found');

      currentUser.status = user.status;

      return await this.save(currentUser);
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getUserInternal(addressString: string): Promise<User> {
    return await this.findOne({ address: addressString });
  }

  async getRefCount(address: string): Promise<Number> {
    const refUser = await this.findOne({ address: address });
    return (await this.find({ usedRef: refUser.ref })).length;
  }

  async getRefCountActive(address: string): Promise<Number> {
    const refUser = await this.findOne({ address: address });
    return (await this.find({ usedRef: refUser.ref, status: Not(UserStatus.NA) })).length;
  }

  async getRefVolume(address: string): Promise<Number> {
    let volume: number = 0;
    const refUser: User = await this.findOne({ address: address });
    let refAddresses: String[] = (await this.find({ usedRef: refUser.ref, status: Not(UserStatus.NA) })).map(
      (a) => a.address,
    );

    (
      await getManager()
        .getCustomRepository(BuyPaymentRepository)
        .find({ where: { address: In(refAddresses), status: PaymentStatus.PROCESSED } })
    ).forEach((a) => (volume += a.fiatValue));

    return volume;
  }

  async getRefData(user: User): Promise<any> {
    return {
      ref: user.ref,
      usedRef: user.usedRef,
      refCount: await this.getRefCount(user.address),
      refCountActive: await this.getRefCountActive(user.address),
      refVolume: await this.getRefVolume(user.address),
    };
  }

  async updateUser(oldUser: User, newUser: UpdateUserDto): Promise<any> {
    try {
      const currentUser = await this.findOne(oldUser.id);
      if (!currentUser) throw new NotFoundException('No matching user for id found');
      const currentUserData = await currentUser.userData;

      const refUser = await this.findOne({ ref: newUser.usedRef });

      if (currentUser.ref == newUser.usedRef || (!refUser && newUser.usedRef)) {
        newUser.usedRef = '000-000';
      } else {
        if (refUser) {
          const refUserData = await refUser.userData;
          if (refUserData && currentUserData) {
            if (refUserData.id == currentUserData.id) newUser.usedRef = '000-000';
          }
        }
      }

      let countryObject = null;
      let languageObject = null;

      // user with kyc cannot change their data
      if (currentUserData.kycStatus != KycStatus.NA) {
        if (newUser.firstname) delete newUser.firstname;
        if (newUser.surname) delete newUser.surname;
        if (newUser.mail) delete newUser.mail;
        if (newUser.street) delete newUser.street;
        if (newUser.houseNumber) delete newUser.houseNumber;
        if (newUser.location) delete newUser.location;
        if (newUser.zip) delete newUser.zip;
        if (newUser.country) delete newUser.country;
        if (newUser.phone) delete newUser.phone;
      }

      if (newUser.country) {
        countryObject = await getManager().getCustomRepository(CountryRepository).getCountry(newUser.country);

        newUser.country = countryObject;
      }

      if (newUser.language) {
        languageObject = await getManager().getCustomRepository(LanguageRepository).getLanguage(newUser.language);

        newUser.language = languageObject;
      }

      newUser.id = currentUser.id;

      await this.save(newUser);

      // if (currentUser.ref == newUser.usedRef || (!refUser && newUser.usedRef))
      //   user.ref = '-1';
      return this.findOne(currentUser.id);
      
    } catch (error) {
      throw new ConflictException(error.message);
    }
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

  async verifyUser(address: string): Promise<any> {
    const currentUser = await this.findOne({ address: address });
    if (!currentUser) throw new NotFoundException('No matching user for id found');

    const requiredFields = ['mail', 'firstname', 'surname', 'street', 'houseNumber', 'location', 'zip', 'country', 'phone']; 
    const errors = requiredFields.filter(f => !currentUser[f]);
     
    return { 
      result: errors.length === 0, 
      errors: errors.reduce((prev, curr) => ({...prev, [curr]: 'missing'}), {}),
    };
  }
}
