import { BadRequestException, Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { CreateFiatOutputDto } from './dto/create-fiat-output.dto';
import { UpdateFiatOutputDto } from './dto/update-fiat-output.dto';
import { FiatOutput } from './fiat-output.entity';
import { FiatOutputService } from './fiat-output.service';

@ApiTags('fiatOutput')
@Controller('fiatOutput')
export class FiatOutputController {
  constructor(private readonly fiatOutputService: FiatOutputService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async create(@Body() dto: CreateFiatOutputDto): Promise<FiatOutput> {
    return this.fiatOutputService.create(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateFiatOutputDto): Promise<FiatOutput> {
    if (dto.batchId && DisabledProcess(Process.FIAT_OUTPUT_BATCH_ID_UPDATE))
      throw new BadRequestException('Process disabled');

    return this.fiatOutputService.update(+id, dto);
  }
}
