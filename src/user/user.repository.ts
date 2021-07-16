import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { User } from "./user.entity";
import * as request from "request-promise-native";
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
    
        const result = await (request.get(options));


        if(JSON.parse(result).response === 'True'){
            

            user.ref = (await this.findOne({order: {"ref": 'DESC'}})).ref + 1;

            const refUser = await this.findOne({"ref": createUserDto.usedRef});

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

    async updateUser(user: UpdateUserDto): Promise<any> {

        const currentUser = await this.findOne({ "id" : user.id });
        
        if(!currentUser) return {"statusCode" : 400, "message": [ "No matching asset for id found"]};

        if(user.ref && user.ref != currentUser.ref) return {"statusCode" : 400, "message": [ "You cannot update your ref!"]};
        if(user.id && user.id != currentUser.id) return {"statusCode" : 400, "message": [ "You cannot update your id!"]};
        if(user.address && user.address != currentUser.address) return {"statusCode" : 400, "message": [ "You cannot update your address!"]};
        if(user.role && user.role != currentUser.role) return {"statusCode" : 400, "message": [ "You cannot update your role!"]};
        if(user.status && user.status != currentUser.status) return {"statusCode" : 400, "message": [ "You cannot update your status!"]};
        if(user.usedRef == currentUser.ref) return {"statusCode" : 400, "message": [ "usedRef must not be your own ref"]};
        
        user.ref = currentUser.ref;
        user.id = currentUser.id;
        user.address = currentUser.address;
        user.signature = currentUser.signature;
        user.role = currentUser.role;

        return await this.save(user);
>>>>>>> 5441a40f48b53e1e9311ac59d8481aa479ff12a9
    }

    async updateRole(user: UpdateRoleDto): Promise<any> {

        const currentUser = await this.findOne({ "id" : user.id });

        if(!currentUser) return {"statusCode" : 400, "message": [ "No matching asset for id found"]};

        // TODO hartkodiert?
        if(user.role == "User" || user.role == "Employee"){
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