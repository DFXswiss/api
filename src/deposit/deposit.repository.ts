import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateDepositDto } from "./dto/create-deposit.dto";
import { Deposit } from "./deposit.entity";

@EntityRepository(Deposit)
export class DepositRepository extends Repository<Deposit> {
    async createDeposit(createDepositDto: CreateDepositDto): Promise<void> {
   
        const deposit = this.create(createDepositDto);

        try {
            await this.save(deposit);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }
}