import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateUserDto } from "./dto/create-user.dto";
import { User } from "./user.entity";
import * as request from "request-promise-native";

@EntityRepository(User)
export class UserRepository extends Repository<User> {
    async createUser(createUserDto: CreateUserDto): Promise<void> {
        const user = this.create(createUserDto);
       
        const baseUrl = 'http://defichain-node.de/api/v1/test/verifymessage';
        const signatureMessage = String("Test123")
        const queryString = '?address='+user.address+'&signature='+user.signature+'&message='+ signatureMessage;
        var options = {
                uri: baseUrl + queryString,
        };
          
        const result = await request.get(options);

        if(result.response === 'True'){
            
      
        try {
            await this.save(user);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }    
    }else{
        throw new InternalServerErrorException();
    }
    }
}