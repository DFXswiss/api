import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateWalletDto } from "./dto/create-wallet.dto";
import { Wallet } from "./wallet.entity";

@EntityRepository(Wallet)
export class WalletRepository extends Repository<Wallet> {
    async createWallet(createWalletDto: CreateWalletDto): Promise<void> {
   
        const wallet = this.create(createWalletDto);

        try {
            await this.save(wallet);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }
}