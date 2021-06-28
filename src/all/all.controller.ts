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
import { ApiHideProperty, ApiTags } from '@nestjs/swagger';
import { hidden } from 'chalk';
import { AdminGuard } from 'src/guards/admin.guard';
import { AllService } from './all.service';

@Controller('all')
export class AllController {
  constructor(private readonly allService: AllService) {}
  
  @ApiTags('all')
  @Get()
  @UseGuards(AdminGuard)
  async getAllRoute(): Promise<any> {
    return this.allService.findAllByAddress();
  }

  
}
