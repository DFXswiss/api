import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateFeeDto } from '../dto/input/create-fee.dto';
import { Fee } from '../entities/fee.entity';
import { FeeService } from '../services/fee.service';

@ApiTags('Fee')
@Controller('fee')
@ApiExcludeController()
export class FeeController {
  constructor(private readonly feeService: FeeService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  @ApiExcludeEndpoint()
  async createFee(@Body() dto: CreateFeeDto): Promise<Fee> {
    return this.feeService.createFee(dto);
  }
}
