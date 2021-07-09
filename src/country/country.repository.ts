import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateCountryDto } from "./dto/create-country.dto";
import { GetCountryDto } from "./dto/get-country.dto";
import { UpdateCountryDto } from "./dto/update-country.dto";
import { Country } from "./country.entity";

@EntityRepository(Country)
export class CountryRepository extends Repository<Country> {

    async createCountry(createCountryDto: CreateCountryDto): Promise<void> {
   
        const country = this.create(createCountryDto);

        try {
            await this.save(country);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }

    async getAllCountry(): Promise<any> {
        return await this.find();
    }

    async getCountry(getCountryDto:GetCountryDto): Promise<any> {
   
        if(getCountryDto.id){
            const country = await this.findOne({ "id" : getCountryDto.id });
        
            if(country) return country;
        }
        if(getCountryDto.symbol){
            const country = await this.findOne({ "symbol" : getCountryDto.symbol });
        
            if(country) return country;
        }
        if(!getCountryDto.name){
            // TODO Error Framework?
            return {"statusCode" : 400, "message": [ "symbol must be a string", "symbol should not be empty", "name must be a string", "name should not be empty"]};
        }else{
            const country = await this.findOne({ "name" : getCountryDto.name });
            
            if(country) return country;
            
            throw new Error('No matching country found');
        }
    }

    async updateCountry(editCountryDto: UpdateCountryDto): Promise<any>{
        return await this.save(editCountryDto);
    }
}