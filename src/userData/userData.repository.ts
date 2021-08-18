import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateUserDataDto } from './dto/create-userData.dto';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { getManager } from 'typeorm';
import { UserData } from './userData.entity';
import { CountryRepository } from 'src/country/country.repository';
import { isString } from 'class-validator';

@EntityRepository(UserData)
export class UserDataRepository extends Repository<UserData> {
  async createUserData(createUserDto: CreateUserDataDto): Promise<UserData> {
    if (createUserDto.id) delete createUserDto.id;
    if (createUserDto.updated) delete createUserDto.updated;
    if (createUserDto.created) delete createUserDto.created;

    let countryObject = null;

    if (createUserDto.country) {
      countryObject = await getManager()
        .getCustomRepository(CountryRepository)
        .getCountry(createUserDto.country);

      createUserDto.country = countryObject.id;
    }

    const userData = this.create(createUserDto);

    try {
      await this.save(userData);
    } catch (error) {
      throw new ConflictException(error.message);
    }

    userData.country = countryObject;

    return userData;
  }

  async getAllUserData(): Promise<any> {
    try {
      return await this.find();
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async updateUserData(newUser: UpdateUserDataDto): Promise<any> {
    try {
      if (newUser.created) delete newUser.created;
      if (newUser.updated) delete newUser.updated;
      if (newUser.location) delete newUser.location;
      if (newUser.name) delete newUser.name;
      if (newUser.country) delete newUser.country;

      const currentUser = await this.findOne({ id: newUser.id });

      if (!currentUser)
        throw new NotFoundException('No matching user for id found');

      await this.save(newUser);

      return Object.assign(currentUser, await this.save(newUser));
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getUserData(key: any): Promise<any> {
    if (!isNaN(key.key)) {
      const userData = await this.findOne({ id: key.key });

      return userData;
    } else if (!isNaN(key)) {
      const userData = await this.findOne({ id: key });

      return userData;
    } else if (
      isString(key.name) &&
      isString(key.location) &&
      !isNaN(key.country)
    ) {
      const userData = await this.findOne({
        name: key.name,
        location: key.location,
        country: key.country,
      });

      return userData;
    }
    throw new BadRequestException('key must be number or JSON-Object');
  }
}
