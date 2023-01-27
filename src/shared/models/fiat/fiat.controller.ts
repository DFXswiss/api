import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { FiatService } from './fiat.service';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatDto } from './dto/fiat.dto';
import { FiatDtoMapper } from './dto/fiat-dto.mapper';

@ApiTags('Fiat')
@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @ApiOkResponse({ type: FiatDto, isArray: true })
  async getAllFiat(): Promise<FiatDto[]> {
    return this.fiatService.getAllFiat().then(FiatDtoMapper.entitiesToDto);
  }
}
