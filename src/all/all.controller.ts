import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHideProperty, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/guards/role.guard';
import { UserRole } from 'src/user/user.entity';
import { AllDataService } from './all.service';

@Controller('allData')
export class AllDataController {
  constructor(private readonly allService: AllDataService) {}
  
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async getAllRoute(): Promise<any> {
    return this.allService.getAllData();
  }

}
