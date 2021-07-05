import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateAssetDto } from "./dto/create-asset.dto";
import { Asset } from "./asset.entity";

@EntityRepository(Asset)
export class AssetRepository extends Repository<Asset> {
    async createAsset(createAssetDto: CreateAssetDto): Promise<void> {
   
        const asset = this.create(createAssetDto);

        try {
            await this.save(asset);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }
    }
}