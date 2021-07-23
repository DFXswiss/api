import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateSellDto } from "./dto/create-sell.dto";
import { UpdateSellDto } from "./dto/update-sell.dto";
import { Sell } from "./sell.entity";
import { DepositRepository } from 'src/deposit/deposit.repository';
import { FiatRepository } from 'src/fiat/fiat.repository';
import { getManager } from "typeorm"; 

@EntityRepository(Sell)
export class SellRepository extends Repository<Sell> {   

    async createSell(createSellDto: CreateSellDto): Promise<any> {
   
        if(createSellDto.id) delete createSellDto["id"];
        
        const entityManager = getManager();
        
        if(createSellDto.fiat) createSellDto.fiat = (await entityManager.getCustomRepository(FiatRepository).getFiat(createSellDto.fiat)).id;
            
        createSellDto.depositId = (await entityManager.getCustomRepository(DepositRepository).getNextDeposit()).id;

        const sell = this.create(createSellDto);

        try {
            await this.save(sell);
        } catch (error) {
             console.log(error);
            throw new InternalServerErrorException();
        }

        return sell;
    }

    async updateSell(sellDto: UpdateSellDto): Promise<any> {

        try{
            const currentSell = await this.findOne({ "id" : sellDto.id});
            
            if(!currentSell) return {"statusCode" : 400, "message": [ "No matching entry for id found"]};
            if(sellDto.address != currentSell.address) return {"statusCode" : 400, "message": [ "You can only change your own sell route"]};

            currentSell.active = sellDto.active;

            return await this.save(currentSell);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }

    async getAllSell(address: string): Promise<any> {
 
        try {
            const sell = await this.find({"address":address});
            
            return sell;
            
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }

    async getSell(id: any, address: string): Promise<any> {

        if(!isNaN(id.key)){
            let sell = await this.findOne({ "id" : id.key });
            
            if(!sell) return {"statusCode" : 400, "message": [ "No matching entry for id found"]};
            if(sell.address != address) return {"statusCode" : 400, "message": [ "You can only get your own sell route"]};
                
            return sell;
        }

        // TODO Error Framework?
        return {"statusCode" : 400, "message": [ "id must be a number"]};
        
    }
}