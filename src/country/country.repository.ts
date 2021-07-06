import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateCountryDto } from "./dto/create-country.dto";
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

    async getCountry(): Promise<void> {
   
        console.log("countryy");
    }
}