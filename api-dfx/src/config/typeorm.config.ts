import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from "@nestjs/typeorm";


@Injectable()
export class TypeOrmConfig implements TypeOrmOptionsFactory {
    constructor(private configService: ConfigService){}

    createTypeOrmOptions(): TypeOrmModuleOptions{
        return {
            type: "mysql",
            host: "localhost",
            port: 3306,
            username: "root",
            password: "admin",
            database: "test",
            synchronize: true,
            logging: false
        }
    }


}