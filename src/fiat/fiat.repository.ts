import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateFiatDto } from "./dto/create-fiat.dto";
import { GetFiatDto } from "./dto/get-fiat.dto";
import { UpdateFiatDto } from "./dto/update-fiat.dto";
import { Fiat } from "./fiat.entity";

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
        return await this.save(fiat);
    }

    async getFiat(getFiatDto: GetFiatDto): Promise<any> {

        if(getFiatDto.id){
            const fiat = await this.findOne({ "id" : getFiatDto.id });
        
            if(fiat) return fiat;
        }
        if(getFiatDto.name){
            const fiat = await this.findOne({ "name" : getFiatDto.name });
        
            if(fiat) return fiat;
            
            throw new Error('No matching fiat found');
        }

        // TODO Error Framework?
        return {"statusCode" : 400, "message": [ "id must be a number", "id should not be empty", "name must be a string", "name should not be empty"]};
        
    }

}