import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config"
import { Observable } from "rxjs";

@Injectable()
export class UserGuard implements CanActivate{
    constructor(private configService: ConfigService){}

    canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
        const request = context.switchToHttp().getRequest();
       

        if(!request.headers.authorization){
            return false;
        }

        const authHeader = request.headers.authorization.split(' ');
        let decodedAuthHeader = Buffer.from(authHeader[1],'base64').toString('ascii').split(':');
        let address = decodedAuthHeader[0];
        let signature = decodedAuthHeader[1];
       
        if(!authHeader[1]){
            return false;
        }

     
    }
}