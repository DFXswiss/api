import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateSpecialExternalAccountDto } from '../dto/input/create-special-external-account.dto';
import { SpecialExternalAccount } from '../entities/special-external-account.entity';
import { SpecialExternalAccountService } from '../services/special-external-account.service';

@ApiTags('SpecialExternalAccount')
@Controller('specialExternalAccount')
@ApiExcludeController()
export class SpecialExternalAccountController {
  constructor(private readonly specialExternalAccountService: SpecialExternalAccountService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  @ApiExcludeEndpoint()
  async createSpecialExternalAccount(@Body() dto: CreateSpecialExternalAccountDto): Promise<SpecialExternalAccount> {
    return this.specialExternalAccountService.createSpecialExternalAccount(dto);
  }
}
