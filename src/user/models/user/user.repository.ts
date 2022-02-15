import { ConflictException, NotFoundException } from '@nestjs/common';
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
  async createUser(dto: CreateUserDto, userIp: string): Promise<User> {
    const user = this.create(dto);

    // wallet
    const walletRepo = getManager().getCustomRepository(WalletRepository);
    user.wallet = (await walletRepo.getWallet(dto.walletId)) ?? walletRepo.getWallet(1);
    user.ip = userIp;

    const refVar = String((await this.find()).length + 1001).padStart(6, '0');
    user.ref = refVar.substr(0, 3) + '-' + refVar.substr(3, 3);

    const refUser = await this.findOne({ ref: dto.usedRef });
    if (user.ref == dto.usedRef || !refUser) user.usedRef = '000-000';

    try {
      await this.save(user);

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
