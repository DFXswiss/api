import { Controller, UseGuards, Put, Param, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatOutputService } from './fiat-output.service';
import { UpdateFiatOutputDto } from './dto/update-fiat-output.dto';
import { FiatOutput } from './fiat-output.entity';

@ApiTags('fiatOutput')
@Controller('fiatOutput')
export class FiatOutputController {
  constructor(private readonly fiatOutputService: FiatOutputService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async update(@Param('id') id: string, @Body() dto: UpdateFiatOutputDto): Promise<FiatOutput> {
    return this.fiatOutputService.update(+id, dto);
  }
}
