import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Request,
  ForbiddenException,
  Post,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiHideProperty, ApiTags } from '@nestjs/swagger';
import { hidden } from 'chalk';
import { RoleGuard } from 'src/guards/role.guard';
import { UserRole } from 'src/user/user.entity';
import { AllService } from './all.service';

@Controller('all')
export class AllController {
  constructor(private readonly allService: AllService) {}
  
  @ApiTags('all')
  @Get()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllRoute(): Promise<any> {
    return this.allService.findAllByAddress();
  }

  
}
