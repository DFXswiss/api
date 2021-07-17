import { InternalServerErrorException } from "@nestjs/common";
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
            return {"statusCode" : 400, "message": [ "type must be 'Coin', 'DAT' or 'DCT'"]};
        }
    }

    async getAllAsset(): Promise<any> {
        return await this.find();
    }

    async updateAsset(asset: UpdateAssetDto): Promise<any> {
        const currentAsset = await this.findOne({ "id" : asset.id });
        
        if(!currentAsset) return {"statusCode" : 400, "message": [ "No matching asset for id found"]};
        
        if(asset.type == "Coin" || asset.type == "DAT" || asset.type == "DCT"){
            return await this.save(asset);
        }else{
            return {"statusCode" : 400, "message": [ "type must be 'Coin', 'DAT' or 'DCT'"]};
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
                    
                return {"statusCode" : 400, "message": [ "No matching asset found"]};
            }

            // TODO Error Framework?
            return {"statusCode" : 400, "message": [ "id must be a number", "OR:", "name must be a string"]};
        }else if(isNaN(key)){
            let asset = await this.findOne({ "id" : key });
                
            if(asset) return asset;
        }else if(isString(key)){
            let asset = await this.findOne({ "name" : key });
                
            if(asset) return asset;
                    
            return {"statusCode" : 400, "message": [ "No matching asset found"]};
        }

        // TODO Error Framework?
        return {"statusCode" : 400, "message": [ "id must be a number", "OR:", "name must be a string"]};
    }
}