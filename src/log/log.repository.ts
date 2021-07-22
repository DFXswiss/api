import { InternalServerErrorException } from "@nestjs/common";
import { EntityRepository, Repository } from "typeorm";
import { CreateLogDto } from "./dto/create-log.dto";
import { UpdateLogDto } from "./dto/update-log.dto";
import { Log } from "./log.entity";
import { isNumber, isString } from "class-validator";

@EntityRepository(Log)
export class LogRepository extends Repository<Log> {
    async createLog(createLogDto: CreateLogDto): Promise<any> {

        if(createLogDto.id) delete createLogDto["id"];
        if(createLogDto.orderId) delete createLogDto["orderId"];
        if(!createLogDto.type || (createLogDto.type != "Info" && createLogDto.type != "Transaction")) return {"statusCode" : 400, "message": [ "type must be Info or Transaction"]};
        if(createLogDto.status && (createLogDto.status != "fiat-deposit" && createLogDto.status != "fiat-to-btc" && createLogDto.status != "btc-to-dfi" && createLogDto.status != "dfi-to-asset" && createLogDto.status != "asset-withdrawal"&& createLogDto.status != "asset-deposit"&& createLogDto.status != "btc-to-fiat"&& createLogDto.status != "dfi-to-btc"&& createLogDto.status != "asset-to-dfi"&& createLogDto.status != "fiat-withdrwal")) return {"statusCode" : 400, "message": [ "wrong status"]};
        if(createLogDto.direction && (createLogDto.direction != "fiat-to-asset" && createLogDto.direction != "asset-to-fiat")) return {"statusCode" : 400, "message": [ "wrong direction"]};

        createLogDto.orderId = createLogDto.address + ":" + new Date().toISOString();

        const log = this.create(createLogDto);

        try {
            await this.save(log);
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException();
        }

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