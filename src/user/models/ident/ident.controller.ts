import { Body, Controller, Get, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { KycDocument } from 'src/user/services/kyc/dto/kyc.dto';
import { LimitRequestDto } from '../limit-request/dto/limit-request.dto';
import { LimitRequest } from '../limit-request/limit-request.entity';
import { LimitRequestService } from '../limit-request/limit-request.service';
import { KycResult } from '../userData/userData.service';
import { IdentService } from './ident.service';

@ApiTags('ident')
@Controller('ident')
export class IdentController {
  constructor(private readonly identService: IdentService, private readonly limitRequestService: LimitRequestService) {}

  @Get()
  async getKycProgress(@Query('code') code: string): Promise<KycResult> {
    return await this.identService.getKycProgress(code);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async requestKyc(@GetJwt() jwt: JwtPayload): Promise<string> {
    return await this.identService.requestKyc(jwt.id).then(JSON.stringify);
  }

  @Post('limit')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async increaseLimit(@GetJwt() jwt: JwtPayload, @Body() request: LimitRequestDto): Promise<LimitRequest> {
    return await this.limitRequestService.increaseLimit(jwt.id, request);
  }

  @Post('incorporationCertificate')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  @UseInterceptors(FilesInterceptor('files'))
  async uploadIncorporationCertificate(
    @GetJwt() jwt: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<boolean> {
    return this.identService.uploadDocument(jwt.id, files[0], KycDocument.INCORPORATION_CERTIFICATE);
  }
}
