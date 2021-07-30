import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { User, UserRole, UserStatus } from './user.entity';
import * as requestPromise from 'request-promise-native';
import { CountryRepository } from 'src/country/country.repository';
import { getManager } from 'typeorm';
import { UpdateStatusDto } from './dto/update-status.dto';

@EntityRepository(User)
export class UserRepository extends Repository<User> {
  async createUser(createUserDto: CreateUserDto): Promise<any> {
    if (createUserDto.id) delete createUserDto['id'];
    if (createUserDto.role) delete createUserDto['role'];
    if (createUserDto.ip) delete createUserDto['ip'];
    if (createUserDto.created) delete createUserDto['created'];

    let countryObject = null;

    if(createUserDto.country){
      countryObject = await getManager()
      .getCustomRepository(CountryRepository)
      .getCountry(createUserDto.country);

      createUserDto.country = countryObject.id;

    }

    const user = this.create(createUserDto);

    const baseUrl = 'http://defichain-node.de/api/v1/test/verifymessage/';
    const signatureMessage = process.env.SIGN_MESSAGE + user.address;
    const queryString =
      '?address="' +
      String(user.address) +
      '"&signature="' +
      String(user.signature).replace('+', '%2b') +
      '"&message="' +
      String(signatureMessage) +
      '"';
    var options = {
      uri: baseUrl + queryString,
    };

    const result = await requestPromise.get(options);

    //TODO aktivieren
    if (true) {
      //JSON.parse(result).response === 'True'){

      const refVar = String((await this.find()).length + 1).padStart(6, '0');

      user.ref = refVar.substr(0, 3) + '-' + refVar.substr(3, 3);
      const refUser = await this.findOne({ "ref": createUserDto.usedRef });

      if (user.ref == createUserDto.usedRef || !refUser)
        user.usedRef = '000-000';

      try {
        await this.save(user);

        createUserDto.country = countryObject;
      } catch (error) {
        console.log(error);
        throw new InternalServerErrorException();
      }

      // if (
      //   user.ref == createUserDto.usedRef ||
      //   (!refUser && createUserDto.usedRef)
      // )
      //   user.ref = '-1';

      return user;
    } else {
      throw new BadRequestException('Wrong signature');
    }
  }

  async getAllUser(): Promise<any> {
    return await this.find();
  }

  async updateStatus(user: UpdateStatusDto): Promise<any> {
    const currentUser = await this.findOne({ "id": user.id });

    if (!currentUser)
      throw new NotFoundException('No matching user for id found');

    if (user.status == UserStatus.ACTIVE || user.status == UserStatus.KYC || user.status == UserStatus.VERIFY) {
      currentUser.status = user.status;
    }
    await this.save(currentUser);

    return await this.findOne({ "id": user.id });

  }

  async updateUser(oldUser: User, newUser: UpdateUserDto): Promise<any> {
    const currentUser = await this.findOne({ "id": oldUser.id });

    if (!currentUser)
      throw new NotFoundException('No matching user for id found');

    const refUser = await this.findOne({ "ref": newUser.usedRef });

    if (currentUser.ref == newUser.usedRef || (!refUser && newUser.usedRef))
      newUser.usedRef = '000-000';

    newUser.ref = currentUser.ref;
    newUser.id = currentUser.id;
    newUser.address = currentUser.address;
    newUser.signature = currentUser.signature;
    newUser.role = currentUser.role;
    newUser.status = currentUser.status;
    newUser.ip = currentUser.ip;
    newUser.created = currentUser.created;

    let countryObject = null;

    if(newUser.status == UserStatus.KYC || newUser.status == UserStatus.VERIFY){

      //TODO Wenn Nutzer bereits verifiziert ist / KYC hat sollte er seine persönlichen Daten nicht mehr einfach können => Absprache mit Robin => Falls er umgezogen ist etc => Verifizierung vll. mit Mitarbeiter?

      if (newUser.firstname) delete newUser['firstname'];
      if (newUser.surname) delete newUser['surname'];
      if (newUser.mail) delete newUser['mail'];
      if (newUser.street) delete newUser['street'];
      if (newUser.houseNumber) delete newUser['houseNumber'];
      if (newUser.location) delete newUser['location'];
      if (newUser.zip) delete newUser['zip'];
      if (newUser.country) delete newUser['country'];
      if (newUser.phone) delete newUser['phone'];

    }

    if(newUser.country){
      countryObject = await getManager()
      .getCustomRepository(CountryRepository)
      .getCountry(newUser.country);

      newUser.country = countryObject.id;

    }else if(oldUser.country && newUser.country != null && newUser.country != ""){
      countryObject = await getManager()
      .getCustomRepository(CountryRepository)
      .getCountry(oldUser.country);
    }

    await this.save(newUser);

    const user = await this.findOne({ "address": newUser.address });
    // if (currentUser.ref == newUser.usedRef || (!refUser && newUser.usedRef))
    //   user.ref = '-1';

    user.country = countryObject;
    delete user['address'];
    delete user['signature'];
    delete user['ip'];
    if (user.role != UserRole.VIP) delete user['role'];

    if (user.status == UserStatus.ACTIVE || user.status == UserStatus.KYC || user.status == UserStatus.VERIFY) {
      return user;
    } else {
      delete user['ref'];
      return user;
    }
  }

  async updateRole(user: UpdateRoleDto): Promise<any> {
    const currentUser = await this.findOne({ "id": user.id });

    if (!currentUser) throw new NotFoundException('No matching user for id found');
    
    currentUser.role = user.role;

    await this.save(currentUser);

    return await this.findOne({ "id": user.id });
  }

  async verifyUser(address:string): Promise<any> {
    const currentUser = await this.findOne({ "address": address });

    if (!currentUser)
      throw new NotFoundException('No matching user for id found');

    let result = { result: true, errors: {} };

    if (currentUser.mail == '' || currentUser.mail == null) {
      result.result = false;
      result.errors['mail'] = 'missing';
    }
    if (currentUser.firstname == '' || currentUser.firstname == null) {
      result.result = false;
      result.errors['firstname'] = 'missing';
    }
    if (currentUser.surname == '' || currentUser.surname == null) {
      result.result = false;
      result.errors['surname'] = 'missing';
    }
    if (currentUser.street == '' || currentUser.street == null) {
      result.result = false;
      result.errors['street'] = 'missing';
    }
    if (currentUser.houseNumber == '' || currentUser.houseNumber == null) {
      result.result = false;
      result.errors['houseNumber'] = 'missing';
    }
    if (currentUser.location == '' || currentUser.location == null) {
      result.result = false;
      result.errors['location'] = 'missing';
    }
    if (currentUser.zip == '' || currentUser.zip == null) {
      result.result = false;
      result.errors['zip'] = 'missing';
    }
    if (currentUser.country == '' || currentUser.country == null) {
      result.result = false;
      result.errors['country'] = 'missing';
    }
    if (currentUser.phone == '' || currentUser.phone == null) {
      result.result = false;
      result.errors['phone'] = 'missing';
    }

    return result;
  }
}
