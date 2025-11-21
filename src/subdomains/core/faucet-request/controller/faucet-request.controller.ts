import { Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FaucetRequestDto } from '../dto/faucet-request.dto';
import { FaucetRequestService } from '../services/faucet-request.service';

@ApiTags('Faucet')
@Controller('faucet')
export class FaucetRequestController {
  constructor(private readonly faucetService: FaucetRequestService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.USER), UserActiveGuard())
  async faucetRequest(@GetJwt() jwt: JwtPayload): Promise<FaucetRequestDto> {
    return this.faucetService.createFaucet(jwt.user);
  }
}
