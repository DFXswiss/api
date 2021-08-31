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

    let countryObject = null;

    if (createUserDto.country) {
      countryObject = await getManager()
        .getCustomRepository(CountryRepository)
        .getCountry(createUserDto.country);

      createUserDto.country = countryObject.id;
    }else{
      delete createUserDto.country;
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

      let currentUser:UserData = null;

      if(newUser.id){
        currentUser = await this.findOne({ id: newUser.id });
      }else if(newUser.location && newUser.name){
        currentUser = await this.findOne({ name: newUser.name, location: newUser.location });
      }

      if (!currentUser)
        throw new NotFoundException('No matching user for id found');

      if(newUser.nameCheck) currentUser.nameCheck = newUser.nameCheck;
      if(newUser.country) currentUser.country = await getManager()
      .getCustomRepository(CountryRepository)
      .getCountry(newUser.country);

      return Object.assign(await this.save(currentUser), newUser);
    } catch (error) {
      throw new ConflictException(error.message);
    }
  }

  async getUserData(key: any): Promise<UserData> {
    if (!isNaN(key.key)) {
      const userData = await this.findOne({ id: key.key });

      return userData;
    } else if (!isNaN(key)) {
      const userData = await this.findOne({ id: key });

      return userData;
    } else if (
      isString(key.name) &&
      isString(key.location)
    ) {
      const userData = await this.findOne({
        name: key.name,
        location: key.location,
      });

      return userData;
    }
    throw new BadRequestException('key must be number or JSON-Object');
  }
}
