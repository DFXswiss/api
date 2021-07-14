import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateBuyDto } from "./dto/create-buy.dto";
import { Buy } from "./buy.entity";
import { sha256 } from 'js-sha256';

@EntityRepository(Buy)
export class BuyRepository extends Repository<Buy> {
    async createBuy(createBuyDto: CreateBuyDto): Promise<void> {
        var hash = sha256.create();
        hash.update(createBuyDto.address+createBuyDto.asset+createBuyDto.iban);
        createBuyDto.bank_usage = hash.toString().toUpperCase().slice(0,4)+'-'+ hash.toString().toUpperCase().slice(4,8)+'-'+hash.toString().toUpperCase().slice(8,12);
        const buy = this.create(createBuyDto);

        try {
            await this.save(buy);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }
}