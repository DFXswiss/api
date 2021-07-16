import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateCountryDto } from "./dto/create-country.dto";
import { GetCountryDto } from "./dto/get-country.dto";
import { UpdateCountryDto } from "./dto/update-country.dto";
import { Country } from "./country.entity";
import { isString } from "class-validator";

@EntityRepository(Country)
export class CountryRepository extends Repository<Country> {

    async createCountry(createCountryDto: CreateCountryDto): Promise<any> {
   
        const country = this.create(createCountryDto);

        try {
            await this.save(country);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }

        return country;
    }

    async getAllCountry(): Promise<any> {
        return await this.find();
    }

    async getCountry(key:any): Promise<any> {
   
        if(!isNaN(key.key)){
            let asset = await this.findOne({ "id" : key.key });
            
            if(asset) return asset;
            
        }else if(isString(key.key)){

            let asset = await this.findOne({ "symbol" : key.key });
            
            if(asset) return asset;

            asset = await this.findOne({ "name" : key.key });
            
            if(asset) return asset;
                
            return {"statusCode" : 400, "message": [ "No matching country found"]};
        }

        // TODO Error Framework?
        return {"statusCode" : 400, "message": [ "id must be a number", "OR:", "name must be a string", "OR:", "symbol must be a string"]};

    }

    async updateCountry(editCountryDto: UpdateCountryDto): Promise<any>{
        const currentCountry = await this.findOne({ "id" : editCountryDto.id });
        
        if(!currentCountry) return {"statusCode" : 400, "message": [ "No matching country for id found"]};

        return await this.save(editCountryDto);
    }
}