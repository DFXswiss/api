import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateBuyDto } from "./dto/create-buy.dto";
import { Buy } from "./buy.entity";

@EntityRepository(Buy)
export class BuyRepository extends Repository<Buy> {
    async createBuy(createBuyDto: CreateBuyDto): Promise<void> {
   
        const buy = this.create(createBuyDto);

        try {
            await this.save(buy);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }
}