import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { TfaGuard } from 'src/subdomains/generic/kyc/guards/tfa.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateRecallDto } from './dto/create-recall.dto';
import { UpdateRecallDto } from './dto/update-recall.dto';
import { Recall } from './recall.entity';
import { RecallService } from './recall.service';

@ApiTags('Recall')
@Controller('recall')
export class RecallController {
  constructor(private readonly recallService: RecallService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async createRecall(@Body() dto: CreateRecallDto): Promise<void> {
    await this.recallService.create(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async updateRecall(@Param('id') id: string, @Body() dto: UpdateRecallDto): Promise<void> {
    await this.recallService.update(+id, dto);
  }

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async getAll(): Promise<Recall[]> {
    return this.recallService.getAll();
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard(), TfaGuard)
  async getById(@Param('id') id: string): Promise<Recall> {
    return this.recallService.getById(+id);
  }
}
