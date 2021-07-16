import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateFiatDto } from "./dto/create-fiat.dto";
import { GetFiatDto } from "./dto/get-fiat.dto";
import { UpdateFiatDto } from "./dto/update-fiat.dto";
import { Fiat } from "./fiat.entity";
import { isNumber, isString } from "class-validator";

@EntityRepository(Fiat)
export class FiatRepository extends Repository<Fiat> {
    async createFiat(createFiatDto: CreateFiatDto): Promise<any> {
   
        const fiat = this.create(createFiatDto);

        try {
            await this.save(fiat);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }

        return fiat;
    }

    async getAllFiat(): Promise<any> {
        return await this.find();
    }

    async updateFiat(fiat: UpdateFiatDto): Promise<any> {

        const currentFiat = await this.findOne({ "id" : fiat.id });
        
        if(!currentFiat) return {"statusCode" : 400, "message": [ "No matching asset for id found"]};

        return await this.save(fiat);
    }

    async getFiat(key: any): Promise<any> {

        if(!isNaN(key.key)){
            let fiat = await this.findOne({ "id" : key.key });
            
            if(fiat) return fiat;
            
        }else if(isString(key.key)){

            let fiat = await this.findOne({ "name" : key.key });
            
            if(fiat) return fiat;
                
            return {"statusCode" : 400, "message": [ "No matching fiat found"]};
        }

        // TODO Error Framework?
        return {"statusCode" : 400, "message": [ "id must be a number", "OR:", "name must be a string"]};
    }

}