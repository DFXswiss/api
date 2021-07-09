import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateDepositDto } from "./dto/create-deposit.dto";
import { UpdateDepositDto } from "./dto/update-deposit.dto";
import { Deposit } from "./deposit.entity";
import { GetDepositDto } from "./dto/get-deposit.dto";

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
        return await this.save(depositAddress);
    }

    async getNextDeposit(): Promise<any> {
        return await this.findOne({ "used" : false});
    }

    async getDeposit(getDepositDto: GetDepositDto): Promise<any> {

        if(getDepositDto.id){
            const deposit = await this.findOne({ "id" : getDepositDto.id });
        
            if(deposit) return deposit;
        }
        if(getDepositDto.address){
            const deposit = await this.findOne({ "address" : getDepositDto.address });
        
            if(deposit) return deposit;
            
            throw new Error('No matching deposit address found');
        }

        // TODO Error Framework?
        return {"statusCode" : 400, "message": [ "id must be a number", "id should not be empty", "address must be a string", "address should not be empty"]};
        
    }
}