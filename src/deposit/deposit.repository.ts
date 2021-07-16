import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateDepositDto } from "./dto/create-deposit.dto";
import { UpdateDepositDto } from "./dto/update-deposit.dto";
import { Deposit } from "./deposit.entity";
import { GetDepositDto } from "./dto/get-deposit.dto";
import { isNumber, isString } from "class-validator";

@EntityRepository(Deposit)
export class DepositRepository extends Repository<Deposit> {
    async createDeposit(createDepositDto: CreateDepositDto): Promise<any> {

        const deposit = this.create(createDepositDto);

        try {
            await this.save(deposit);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }

        return deposit;
    }

    async getAllDeposit(): Promise<any> {
        return await this.find();
    }

    async updateDeposit(depositAddress: UpdateDepositDto): Promise<any> {
        const currentDeposit = await this.findOne({ "id" : depositAddress.id });
        
        if(!currentDeposit) return {"statusCode" : 400, "message": [ "No matching deposit address for id found"]};

        return await this.save(depositAddress);
    }

    async getNextDeposit(): Promise<any> {
        return await this.findOne({ "used" : false});
    }

    async getDeposit(key: any): Promise<any> {

        if(!isNaN(key.key)){
            let asset = await this.findOne({ "id" : key.key });
            
            if(asset) return asset;
            
        }else if(isString(key.key)){

            let asset = await this.findOne({ "address" : key.key });
            
            if(asset) return asset;
                
            return {"statusCode" : 400, "message": [ "No matching deposit address found"]};
        }
    }
}