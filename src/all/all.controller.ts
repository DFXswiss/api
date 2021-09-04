import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiHideProperty, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/guards/role.guard';
import { UserRole } from 'src/user/user.entity';
import { AllDataService } from './all.service';

@Controller('allData')
export class AllDataController {
  constructor(private readonly allService: AllDataService) {}
  
  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllRoute(): Promise<any> {
    return this.allService.getAllData();
  }

  @Get('user')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllUserRoute(): Promise<any> {
    return this.allService.getAllUser();
  }

  @Get('userData')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllUserDataRoute(): Promise<any> {
    return this.allService.getAllUserData();
  }

  @Get('buy')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllBuyRoute(): Promise<any> {
    return this.allService.getAllBuy();
  }

  @Get('sell')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllSellRoute(): Promise<any> {
    return this.allService.getAllSell();
  }

  @Get('wallet')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllWalletRoute(): Promise<any> {
    return this.allService.getAllWallet();
  }

  @Get('log')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllLogRoute(): Promise<any> {
    return this.allService.getAllLog();
  }

  @Get('payment')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllPaymentRoute(): Promise<any> {
    return this.allService.getAllPayment();
  }

}
