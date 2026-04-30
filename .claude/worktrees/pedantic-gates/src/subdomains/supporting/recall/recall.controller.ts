import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateRecallDto } from './dto/create-recall.dto';
import { UpdateRecallDto } from './dto/update-recall.dto';
import { RecallService } from './recall.service';

@ApiTags('Recall')
@Controller('recall')
export class RecallController {
  constructor(private readonly recallService: RecallService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async createRecall(@Body() dto: CreateRecallDto): Promise<void> {
    await this.recallService.create(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateRecall(@Param('id') id: string, @Body() dto: UpdateRecallDto): Promise<void> {
    await this.recallService.update(+id, dto);
  }
}
