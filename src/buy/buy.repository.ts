import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateBuyDto } from "./dto/create-buy.dto";
import { Buy } from "./buy.entity";
import { sha256 } from 'js-sha256';
import { UpdateBuyDto } from "./dto/update-buy.dto";

@EntityRepository(Buy)
export class BuyRepository extends Repository<Buy> {
    
    async createBuy(createBuyDto: CreateBuyDto): Promise<any> {
        var hash = sha256.create();
        hash.update(createBuyDto.address+createBuyDto.asset+createBuyDto.iban);
        createBuyDto.bankUsage = hash.toString().toUpperCase().slice(0,4)+'-'+ hash.toString().toUpperCase().slice(4,8)+'-'+hash.toString().toUpperCase().slice(8,12);
        const buy = this.create(createBuyDto);
        try {
            if(buy){
                if(buy.address === createBuyDto.address){
                    await this.save(buy);
                    return buy;
                }else{
                    return "Not your own address" //TODO Error Message
                }
            }
        } catch (error) {
            console.log(error.message); //TODO Error message 
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
                    return buy;
                }
            }
           
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }

    async getBuy(key: any, address: string): Promise<any> {
 
       
        try {
            const buy = await this.findOne({"id":key.key});
            
            if(buy){
                if(buy.address === address){
                    return buy;
                }else{
                    return "Not your address";
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