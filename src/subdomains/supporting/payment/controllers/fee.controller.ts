import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { CreateFeeDto } from '../dto/create-fee.dto';
import { Fee } from '../entities/fee.entity';
import { FeeService } from '../services/fee.service';

@ApiTags('Fee')
@Controller('fee')
@ApiExcludeController()
export class FeeController {
  constructor(private readonly feeService: FeeService, private readonly userDataService: UserDataService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async createFee(@Body() dto: CreateFeeDto): Promise<Fee> {
    return this.feeService.createFee(dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @ApiExcludeEndpoint()
  async getUserDataFeeAmount(@Query('userDataId') id: string): Promise<{ buy: number; sell: number; crypto: number }> {
    return this.feeService.getAllUserFee(+id);
  }
}
