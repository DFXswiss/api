import {
    BadRequestException,
    ForbiddenException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { EntityRepository, Repository } from 'typeorm';
import { CreateUserDataDto } from './dto/create-userData.dto';
import { UpdateUserDataDto } from './dto/update-userData.dto';
import { getManager } from 'typeorm';
import { UserData } from './userData.entity';
import { CountryRepository } from 'src/country/country.repository';
  
  @EntityRepository(UserData)
  export class UserDataRepository extends Repository<UserData> {
    async createUser(createUserDto: CreateUserDataDto): Promise<UserData> {
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
            console.log(error);
            throw new InternalServerErrorException();
        }

        userData.country = countryObject;

        return userData;
    }
  
    async getAllUserData(): Promise<any> {
        return await this.find();
    }
  
    async updateUser(newUser: UpdateUserDataDto): Promise<any> {

        if(newUser.created) delete newUser.created;
        if(newUser.updated) delete newUser.updated;
        if(newUser.location) delete newUser.location;
        if(newUser.name) delete newUser.name;
        if(newUser.country) delete newUser.country;

        const currentUser = await this.findOne({ id: newUser.id });
    
        if (!currentUser)
            throw new NotFoundException('No matching user for id found');
    
        await this.save(newUser);

        return Object.assign(currentUser, await this.save(newUser));
    }

    async getUser(key: any): Promise<any> {
        
        if(!isNaN(key.key)){
            let userData = await this.findOne({ "id" : key.key });
            
            if(userData) return userData;
            
        }else if(!isNaN(key)){
            let userData = await this.findOne({ "id" : key });
            
            if(userData) return userData;
        }

        throw new BadRequestException("key must be number or JSON-Object")

    }
  }