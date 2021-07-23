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

        if(createUserDto.id) delete createUserDto["id"];
        if(createUserDto.role) delete createUserDto["role"];
        if(createUserDto.ip) delete createUserDto["ip"];

        const user = this.create(createUserDto);
       
        const baseUrl = 'http://defichain-node.de/api/v1/test/verifymessage';
        const signatureMessage = process.env.SIGN_MESSAGE+user.address;
        const queryString = '?address="' + String(user.address) + '"&signature="' + String(user.signature).replace('+','%2b') + '"&message="' + String(signatureMessage)+'"';
        var options = {
            uri: baseUrl + queryString,
        };
    
        const result = await (requestPromise.get(options));

        //TODO
        if(true){ //JSON.parse(result).response === 'True'){
            
            const refVar = ((String((await this.find()).length + 1)).padStart(6,"0"));

            user.ref = refVar.substr(0,3) + "-" + refVar.substr(3,3);
            const refUser = await this.findOne({"ref": createUserDto.usedRef});

            if(user.ref == createUserDto.usedRef || !refUser) user.usedRef = "000-000";
            
            try {
                await this.save(user);
            } catch (error) {
                console.log(error);
                throw new InternalServerErrorException();
            }    

            if(user.ref == createUserDto.usedRef || (!refUser && createUserDto.usedRef)) user.ref = "-1";
            
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

        const refUser = await this.findOne({"ref": newUser.usedRef});

        if(newUser.id && newUser.id != currentUser.id) return {"statusCode" : 400, "message": [ "You cannot update your id!"]};
        if(currentUser.ref == newUser.usedRef || (!refUser && newUser.usedRef)) newUser.usedRef = "000-000";
        
        newUser.ref = currentUser.ref;
        newUser.id = currentUser.id;
        newUser.address = currentUser.address;
        newUser.signature = currentUser.signature;
        newUser.role = currentUser.role;
        newUser.status = currentUser.status;
        newUser.ip = currentUser.ip;

        const user = await this.save(newUser);

        if(currentUser.ref == newUser.usedRef || (!refUser && newUser.usedRef)) user.ref = "-1";

        delete user["signature"];
        delete user["ip"];

        if(user.status == "Active" || user.status == "KYC"){
            return user;
        }else{
            delete user["ref"];
            return user;
        }
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