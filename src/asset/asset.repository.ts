import { InternalServerErrorException, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateAssetDto } from "./dto/create-asset.dto";
import { UpdateAssetDto } from "./dto/update-asset.dto";
import { Asset } from "./asset.entity";
import { isNumber, isString } from "class-validator";

@EntityRepository(Asset)
export class AssetRepository extends Repository<Asset> {
    async createAsset(createAssetDto: CreateAssetDto): Promise<any> {
   
        if(createAssetDto.id) delete createAssetDto["id"];

        // TODO Sollen wir das hartkodieren?
        if(createAssetDto.type == "Coin" || createAssetDto.type == "DAT" || createAssetDto.type == "DCT"){

            const asset = this.create(createAssetDto);

            try {
                await this.save(asset);
            } catch (error) {
                console.log(error);
                throw new InternalServerErrorException();
            }

            return asset;

        }else{
            throw new BadRequestException("type must be Coin or DAT or DCT")
        }
    }

    async getAllAsset(): Promise<any> {
        return await this.find();
    }

    async updateAsset(asset: UpdateAssetDto): Promise<any> {
        const currentAsset = await this.findOne({ "id" : asset.id });
        
        if(!currentAsset) throw new NotFoundException( "No matching asset for id found");
        
        if(asset.type == "Coin" || asset.type == "DAT" || asset.type == "DCT"){
            return await this.save(asset);
        }else{
            throw new BadRequestException("type must be Coin or DAT or DCT")
        }
    }

    async getAsset(key: any): Promise<any> {

        if(key.key){
            if(!isNaN(key.key)){
                let asset = await this.findOne({ "id" : key.key });
                
                if(asset) return asset;
                
            }else if(isString(key.key)){

                let asset = await this.findOne({ "name" : key.key });
                
                if(asset) return asset;
                
                throw new NotFoundException( "No matching asset found");
            }

            // TODO Error Framework?
            return {"statusCode" : 400, "message": [ "id must be a number", "OR:", "name must be a string"]};
        }else if(!isNaN(key)){
            let asset = await this.findOne({ "id" : key });
                
            if(asset) return asset;
        }else if(isString(key)){
            let asset = await this.findOne({ "name" : key });
                
            if(asset) return asset;
                    
            throw new NotFoundException( "No matching asset found");
        }else if(key.id){
            
            let asset = await this.findOne({ "id" : key.id });
                
            if(asset) return asset; 
            
            throw new NotFoundException( "No matching asset found");
            
        }else if(key.name){

            let asset = await this.findOne({ "name" : key.name });
                
            if(asset) return asset;
                    
            throw new NotFoundException( "No matching asset found");
        }
        
        throw new BadRequestException("key must be number or string or JSON-Object")
    }
}