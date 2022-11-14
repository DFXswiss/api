import { Controller, UseGuards, Body, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateFiatOutputDto } from './dto/create-fiat-output.dto';
import { FiatOutput } from './fiat-output.entity';
import { FiatOutputService } from './fiat-output.service';

@ApiTags('fiatOutput')
@Controller('fiatOutput')
export class FiatOutputController {
  constructor(private readonly fiatOutputService: FiatOutputService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async create(@Body() dto: CreateFiatOutputDto): Promise<FiatOutput> {
    return this.fiatOutputService.create(dto);
  }
}
