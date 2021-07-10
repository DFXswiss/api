import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateAssetDto } from "./dto/create-asset.dto";
import { GetAssetDto } from "./dto/get-asset.dto";
import { UpdateAssetDto } from "./dto/update-asset.dto";
import { Asset } from "./asset.entity";

@EntityRepository(Asset)
export class AssetRepository extends Repository<Asset> {
    async createAsset(createAssetDto: CreateAssetDto): Promise<any> {
   
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

    async getAsset(getAssetDto: GetAssetDto): Promise<any> {

        if(getAssetDto.id){
            const asset = await this.findOne({ "id" : getAssetDto.id });
        
            if(asset) return asset;
        }
        if(getAssetDto.name){
            const asset = await this.findOne({ "name" : getAssetDto.name });
        
            if(asset) return asset;
            
            return {"statusCode" : 400, "message": [ "No matching asset found"]};
        }

        // TODO Error Framework?
        return {"statusCode" : 400, "message": [ "id must be a number", "id should not be empty", "name must be a string", "name should not be empty"]};
        
    }
}