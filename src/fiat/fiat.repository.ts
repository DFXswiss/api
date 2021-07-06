import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateFiatDto } from "./dto/create-fiat.dto";
import { Fiat } from "./fiat.entity";

@EntityRepository(Fiat)
export class FiatRepository extends Repository<Fiat> {
    async createFiat(createFiatDto: CreateFiatDto): Promise<void> {
   
        const fiat = this.create(createFiatDto);

        try {
            await this.save(fiat);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }
}