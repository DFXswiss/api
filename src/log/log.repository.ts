import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, getManager, Repository } from "typeorm";
import { CreateLogDto } from "./dto/create-log.dto";
import { UpdateLogDto } from "./dto/update-log.dto";
import { Log, LogDirection, LogStatus } from "./log.entity";
import { isNumber, isString } from "class-validator";
import { FiatRepository } from "src/fiat/fiat.repository";
import { AssetRepository } from "src/asset/asset.repository";

@EntityRepository(Log)
export class LogRepository extends Repository<Log> {
    async createLog(createLogDto: CreateLogDto): Promise<any> {

        if(createLogDto.id) delete createLogDto.id;
        if(createLogDto.orderId) delete createLogDto.orderId;
        if (createLogDto.created) delete createLogDto.created;
        if(!createLogDto.type || (createLogDto.type != "Info" && createLogDto.type != "Transaction")) return {"statusCode" : 400, "message": [ "type must be Info or Transaction"]};
        if(createLogDto.status && (createLogDto.status != LogStatus.fiatDeposit && createLogDto.status != LogStatus.fiat2btc && createLogDto.status != LogStatus.btc2dfi && createLogDto.status != LogStatus.dfi2asset && createLogDto.status != LogStatus.assetWithdrawal && createLogDto.status != LogStatus.assetDeposit && createLogDto.status != LogStatus.btc2fiat && createLogDto.status != LogStatus.dfi2btc && createLogDto.status != LogStatus.asset2dfi && createLogDto.status != LogStatus.fiatWithdrawal)) return {"statusCode" : 400, "message": [ "wrong status"]};
        if(createLogDto.direction && (createLogDto.direction != LogDirection.fiat2asset && createLogDto.direction != LogDirection.asset2fiat)) return {"statusCode" : 400, "message": [ "wrong direction"]};

        let fiatObject = null;
        let assetObject = null;

        if(createLogDto.fiat) fiatObject = await getManager().getCustomRepository(FiatRepository).getFiat(createLogDto.fiat);
        if(createLogDto.asset) assetObject = await getManager().getCustomRepository(AssetRepository).getAsset(createLogDto.asset);

        createLogDto.fiat = fiatObject.id;
        createLogDto.asset = assetObject.id;

        createLogDto.orderId = createLogDto.address + ":" + new Date().toISOString();

        const log = this.create(createLogDto);

        try {
            await this.save(log);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }

        log.fiat = fiatObject;
        log.asset = assetObject;

        return log;
    }

    async getAllLog(): Promise<any> {
        return await this.find();
    }

    // async updateLog(log: UpdateLogDto): Promise<any> {
    //     const currentLog = await this.findOne({ "id" : log.id });
        
    //     if(!currentLog) return {"statusCode" : 400, "message": [ "No matching deposit address for id found"]};

    //     return await this.save(log);
    // }

    async getLog(key: any): Promise<any> {

        if(!isNaN(key.key)){
            let log = await this.findOne({ "id" : key.key });
            
            if(log) return log;
            
        }else if(isString(key.key)){

            let log = await this.findOne({ "address" : key.key });
            
            if(log) return log;

            log = await this.findOne({ "orderId" : key.key });
            
            if(log) return log;
                
            return {"statusCode" : 400, "message": [ "No matching log found"]};
        }
    }
}