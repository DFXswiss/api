import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { User, UserRole } from "./user.entity";
import * as requestPromise from "request-promise-native";
import { Z_STREAM_ERROR } from "zlib";

@EntityRepository(User)
export class UserRepository extends Repository<User> {
    async createUser(createUserDto: CreateUserDto): Promise<any> {
        const user = this.create(createUserDto);
       
        const baseUrl = 'http://defichain-node.de/api/v1/test/verifymessage';
        const signatureMessage = process.env.SIGN_MESSAGE+user.address;
        const queryString = '?address="' + String(user.address) + '"&signature="' + String(user.signature).replace('+','%2b') + '"&message="' + String(signatureMessage)+'"';
        var options = {
            uri: baseUrl + queryString,
        };
    
        const result = await (requestPromise.get(options));


        if(true){ //JSON.parse(result).response === 'True'){
            
            user.ref =  1;
            const refUser = {} //await this.findOne({"ref": createUserDto.usedRef});

            if(user.ref == createUserDto.usedRef){
                return {"statusCode" : 400, "message": [ "usedRef must not be your own ref"]};
            }else if(!refUser){
                return {"statusCode" : 400, "message": [ "usedRef doesn't exist"]};            
            }

            try {
                await this.save(user);
            } catch (error) {
                console.log(error);
                throw new InternalServerErrorException();

            }    

            return user;
        
        }else{
            //TODO Signature not valid
        }

    }

    async getAllUser(): Promise<any> {
        return await this.find();
    }

    async updateStatus(user: UpdateUserDto): Promise<any> {
        const currentUser = await this.findOne({ "id" : user.id });
        
        if(!currentUser) return {"statusCode" : 400, "message": [ "No matching asset for id found"]};

        if(user.status == "Active" || user.status == "KYC"){
            currentUser.status = user.status;
        }
        return await this.save(currentUser);
    }

    async updateUser(oldUser: User,newUser: UpdateUserDto): Promise<any> {

        const currentUser = await this.findOne({ "id" : oldUser.id });
        
        if(!currentUser) return {"statusCode" : 400, "message": [ "No matching asset for id found"]};

        if(newUser.ref && newUser.ref != currentUser.ref) return {"statusCode" : 400, "message": [ "You cannot update your ref!"]};
        if(newUser.id && newUser.id != currentUser.id) return {"statusCode" : 400, "message": [ "You cannot update your id!"]};
        if(newUser.address && newUser.address != currentUser.address) return {"statusCode" : 400, "message": [ "You cannot update your address!"]};
        if(newUser.role && newUser.role != currentUser.role) return {"statusCode" : 400, "message": [ "You cannot update your role!"]};
        if(newUser.status && newUser.status != currentUser.status) return {"statusCode" : 400, "message": [ "You cannot update your status!"]};
        if(newUser.usedRef == currentUser.ref) return {"statusCode" : 400, "message": [ "usedRef must not be your own ref"]};
        
        newUser.ref = currentUser.ref;
        newUser.id = currentUser.id;
        newUser.address = currentUser.address;
        newUser.signature = currentUser.signature;
        newUser.role = currentUser.role;

        return await this.save(newUser);
    }

    async updateRole(user: UpdateRoleDto): Promise<any> {

        const currentUser = await this.findOne({ "id" : user.id });

        if(!currentUser) return {"statusCode" : 400, "message": [ "No matching asset for id found"]};

        // TODO hartkodiert?
        if(user.role == UserRole.USER || user.role == UserRole.EMPLOYEE || user.role == UserRole.VIP){
            currentUser.role = user.role;
        }

        return await this.save(currentUser);

    }

    async verifyUser(user: UpdateUserDto): Promise<any> {
        const currentUser = await this.findOne({ "id" : user.id });
        
        if(!currentUser) return {"statusCode" : 400, "message": [ "No matching asset for id found"]};

        let result = {"result": true, "errors": {}};

        if(currentUser.mail == "" || currentUser.mail == null){
            result.result = false;
            result.errors["mail"] = "missing";
        }
        if(currentUser.firstname == "" || currentUser.firstname == null){
            result.result = false;
            result.errors["firstname"] = "missing";
        }
        if(currentUser.surname == "" || currentUser.surname == null){
            result.result = false;
            result.errors["surname"] = "missing";
        }
        if(currentUser.street == "" || currentUser.street == null){
            result.result = false;
            result.errors["street"] = "missing";
        }
        if(currentUser.houseNumber == "" || currentUser.houseNumber == null){
            result.result = false;
            result.errors["houseNumber"] = "missing";
        }
        if(currentUser.location == "" || currentUser.location == null){
            result.result = false;
            result.errors["location"] = "missing";
        }
        if(currentUser.zip == "" || currentUser.zip == null){
            result.result = false;
            result.errors["zip"] = "missing";
        }
        if(currentUser.country == "" || currentUser.country == null){
            result.result = false;
            result.errors["country"] = "missing";
        }
        if(currentUser.phone == "" || currentUser.phone == null){
            result.result = false;
            result.errors["phone"] = "missing";
        }

        return result;
    }

}