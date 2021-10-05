import { Body, Controller, Get, Param, Put, UseGuards, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiParam, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { FiatService } from './fiat.service';
import { CreateFiatDto } from './dto/create-fiat.dto';
import { UpdateFiatDto } from './dto/update-fiat.dto';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/shared/auth/user-role.enum';

@ApiTags('fiat')
@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService) {}

  @Get(':key')
  @ApiBearerAuth()
  @ApiParam({
    name: 'key',
    required: true,
    description: 'either an integer for the fiat id or a string for the fiat name',
    schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
  })
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getFiat(@Param() fiat: any): Promise<any> {
    return this.fiatService.getFiat(fiat);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllFiat(): Promise<any> {
    return this.fiatService.getAllFiat();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createFiat(@Body() createFiatDto: CreateFiatDto): Promise<any> {
    return this.fiatService.createFiat(createFiatDto);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateFiat(@Body() fiat: UpdateFiatDto) {
    return this.fiatService.updateFiat(fiat);
  }
}
