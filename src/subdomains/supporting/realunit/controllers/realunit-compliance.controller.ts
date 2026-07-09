import { Controller, Get, Param, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Util } from 'src/shared/utils/util';
import { KycFileDataDto } from 'src/subdomains/generic/kyc/dto/kyc-file.dto';
import {
  RealUnitCustomerDetailDto,
  RealUnitCustomerListDto,
  RealUnitCustomerSearchQuery,
  RealUnitKycFileDto,
} from '../dto/realunit-compliance.dto';
import { RealUnitComplianceService } from '../realunit-compliance.service';

// RealUnit tenant compliance dashboard: read-only, strictly customer-scoped views for RealUnit staff
// (UserRole.REALUNIT) over ONLY their own customers. The DFX RoleGuard is never widened; every endpoint asserts
// tenant membership in the service (fail-closed 404) before returning any data, and KYC file access is both
// allowlisted and audit-logged.
@ApiTags('Realunit')
@Controller('realunit/compliance')
export class RealUnitComplianceController {
  constructor(private readonly complianceService: RealUnitComplianceService) {}

  @Get('customers')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async searchCustomers(@Query() query: RealUnitCustomerSearchQuery): Promise<RealUnitCustomerListDto[]> {
    return this.complianceService.searchCustomers(query.key);
  }

  @Get('customers/:id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getCustomer(@Param('id') id: string): Promise<RealUnitCustomerDetailDto> {
    return this.complianceService.getReducedDossier(+id);
  }

  @Get('customers/:id/files')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async getCustomerFiles(@Param('id') id: string): Promise<RealUnitKycFileDto[]> {
    return this.complianceService.listCustomerFiles(+id);
  }

  @Get('customers/:id/dossier')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async downloadCustomerDossier(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res,
  ): Promise<StreamableFile> {
    const zipContent = await this.complianceService.downloadCustomerDossier(+id, jwt);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="RealUnit_dossier_${+id}_${Util.filenameDate()}.zip"`,
    });

    return new StreamableFile(zipContent);
  }

  @Get('customers/:id/files/:uid')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.REALUNIT), UserActiveGuard())
  async downloadCustomerFile(
    @GetJwt() jwt: JwtPayload,
    @Param('id') id: string,
    @Param('uid') uid: string,
  ): Promise<KycFileDataDto> {
    return this.complianceService.downloadCustomerFile(+id, uid, jwt);
  }
}
