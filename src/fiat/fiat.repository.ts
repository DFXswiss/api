import { InternalServerErrorException, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateFiatDto } from "./dto/create-fiat.dto";
import { UpdateFiatDto } from "./dto/update-fiat.dto";
import { Fiat } from "./fiat.entity";
import { isNumber, isString } from "class-validator";

@EntityRepository(Fiat)
export class FiatRepository extends Repository<Fiat> {
    async createFiat(createFiatDto: CreateFiatDto): Promise<any> {
   
        if(createFiatDto.id) delete createFiatDto.id;
        if (createFiatDto.created) delete createFiatDto.created;

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
        
        if(!currentFiat) throw new NotFoundException( "No matching fiat for id found");

        fiat.created = currentFiat.created;

        return Object.assign(currentFiat, await this.save(fiat));
    }

    async getFiat(key: any): Promise<any> {

        if(key.key){
            if(!isNaN(key.key)){
                let fiat = await this.findOne({ "id" : key.key });
                
                if(fiat) return fiat;
                
            }else if(isString(key.key)){

                let fiat = await this.findOne({ "name" : key.key });
                
                if(fiat) return fiat;
                    
                throw new NotFoundException( "No matching fiat found");
            }
            
        }else if(!isNaN(key)){

            let fiat = await this.findOne({ "id" : key });
                
            if(fiat) return fiat;

        }else if(isString(key)){

            let fiat = await this.findOne({ "name" : key });
                
            if(fiat) return fiat;
                    
            throw new NotFoundException( "No matching fiat found");
        }else if(key.id){
            
            let fiat = await this.findOne({ "id" : key.id });
                
            if(fiat) return fiat; 
            
            throw new NotFoundException( "No matching fiat found");
            
        }else if(key.name){

            let fiat = await this.findOne({ "name" : key.name });
                
            if(fiat) return fiat;
                    
            throw new NotFoundException( "No matching fiat found");
        }

        throw new BadRequestException("key must be number or string or JSON-Object")
    }

}