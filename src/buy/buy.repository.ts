import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateBuyDto } from "./dto/create-buy.dto";
import { Buy } from "./buy.entity";
import { sha256 } from 'js-sha256';
import { GetBuyDto } from "./dto/get-buy.dto";
import { UpdateBuyDto } from "./dto/update-buy.dto";
import { UserRepository } from "src/user/user.repository";
import { InjectRepository } from "@nestjs/typeorm";

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

    async updateBuy(updateBuyDto: UpdateBuyDto): Promise<any> {

        try {
            const buy = await this.findOne(updateBuyDto.id);

            if(buy){
                if(buy.address === updateBuyDto.address){
                    buy.active = updateBuyDto.active;
                    await this.save(buy);
                }
            }
           
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }

    async getBuy(getBuyDto: GetBuyDto): Promise<any> {
 
        try {
            const buy = await this.findOne(getBuyDto.id);

            if(buy){
                if(buy.address === getBuyDto.address){
                    return buy;
                }else{
                    return "not your own"; //TODO Error message
                }
                
            }else{
                return "No buy route"; //TODO Error message
            }
            
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
        
    }

    async getAllBuy(address: string): Promise<any> {
 
        try {
            const buy = await this.find({"address":address});

            if(buy){
                return buy;
            }else{
                return "No buy routes"; //TODO Error message
            }
            
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
        
    }

}