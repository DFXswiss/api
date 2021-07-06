import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateSellDto } from "./dto/create-sell.dto";
import { Sell } from "./sell.entity";

@EntityRepository(Sell)
export class SellRepository extends Repository<Sell> {
    async createSell(createSellDto: CreateSellDto): Promise<void> {
   
        const sell = this.create(createSellDto);

        try {
            await this.save(sell);
        } catch (error) {
             console.log(error);
            throw new InternalServerErrorException();
        }
    }
}