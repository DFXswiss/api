import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBadRequestResponse, ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RealUnitRegistrationDto } from '../dto/input/realunit-registration.dto';
import { KycStep } from '../entities/kyc-step.entity';
import { RealUnitService } from '../services/realunit.service';

@ApiTags('RealUnit')
@Controller('realunit')
export class RealUnitController {
  constructor(private readonly realUnitService: RealUnitService) {}

  @Post('register')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ACCOUNT), UserActiveGuard())
  @ApiOperation({ summary: 'Register for RealUnit' })
  @ApiCreatedResponse({ description: 'Registration saved successfully' })
  @ApiBadRequestResponse({ description: 'Invalid signature or wallet does not belong to user' })
  async register(@GetJwt() jwt: JwtPayload, @Body() dto: RealUnitRegistrationDto): Promise<{ id: number }> {
    const kycStep = await this.realUnitService.register(jwt.account, dto);
    return { id: kycStep.id };
  }
}
