import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import {
  UserDataSupportInfoDetails,
  UserDataSupportInfoResult,
  UserDataSupportQuery,
} from './dto/user-data-support.dto';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async searchUserByKey(@Query() query: UserDataSupportQuery): Promise<UserDataSupportInfoResult> {
    return this.supportService.searchUserDataByKey(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.COMPLIANCE), UserActiveGuard())
  async getUserData(@Param('id') id: string): Promise<UserDataSupportInfoDetails> {
    return this.supportService.getUserDataDetails(+id);
  }
}
