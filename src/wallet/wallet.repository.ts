import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateWalletDto } from "./dto/create-wallet.dto";
import { GetWalletDto } from "./dto/get-wallet.dto";
import { UpdateWalletDto } from "./dto/update-wallet.dto";
import { Wallet } from "./wallet.entity";

@EntityRepository(Wallet)
export class WalletRepository extends Repository<Wallet> {
    async createWallet(createWalletDto: CreateWalletDto): Promise<any> {
   
        const wallet = this.create(createWalletDto);

        try {
            await this.save(wallet);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }

        return wallet;
    }

    async getAllWallet(): Promise<any> {
        return await this.find();
    }

    async getWallet(walletDto:GetWalletDto): Promise<any> {
   
        if(walletDto.id){
            const wallet = await this.findOne({ "id" : walletDto.id });
        
            if(wallet) return wallet;
        }
        if(!walletDto.address){
            // TODO Error Framework?
            return {"statusCode" : 400, "message": [ "id must be a number", "id should not be empty", "OR:" ,"address must be a string", "address should not be empty"]};
        }else{
            const wallet = await this.findOne({ "address" : walletDto.address });
            
            if(wallet) return wallet;
            
            throw new Error('No matching wallet found');
        }
    }

    async updateWallet(editWalletDto: UpdateWalletDto): Promise<any>{
        const currentWallet = await this.findOne({ "id" : editWalletDto.id });
        
        if(!currentWallet) return {"statusCode" : 400, "message": [ "No matching country for id found"]};

        return await this.save(editWalletDto);
    }




}