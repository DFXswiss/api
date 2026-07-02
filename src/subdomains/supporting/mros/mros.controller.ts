import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { TfaGuard } from 'src/subdomains/generic/kyc/guards/tfa.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateMrosDto } from './dto/create-mros.dto';
import { UpdateMrosDto } from './dto/update-mros.dto';
import { Mros } from './mros.entity';
import { MrosService } from './mros.service';

@ApiTags('Mros')
@Controller('mros')
export class MrosController {
  constructor(private readonly mrosService: MrosService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async createMros(@Body() dto: CreateMrosDto): Promise<void> {
    await this.mrosService.create(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async updateMros(@Param('id') id: string, @Body() dto: UpdateMrosDto): Promise<void> {
    await this.mrosService.update(+id, dto);
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async getAll(): Promise<Mros[]> {
    return this.mrosService.getAll();
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async getById(@Param('id') id: string): Promise<Mros> {
    return this.mrosService.getById(+id);
  }
}
