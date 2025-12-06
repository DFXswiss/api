import { BadRequestException, Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { RealUnitRegistrationResponseDto, RealUnitUserRegistrationDto } from '../dto/realunit-registration.dto';
import { verifyEIP712Signature } from '../utils/eip712-verification';

interface AktionariatRegistrationResponse {
  success: boolean;
  registrationId?: string;
  message?: string;
}

@Injectable()
export class RealUnitRegistrationService {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(private readonly http: HttpService) {
    const config = GetConfig().blockchain.realunit;
    this.apiUrl = config.registrationApiUrl;
    this.apiKey = config.registrationApiKey;
  }

  async registerUser(dto: RealUnitUserRegistrationDto): Promise<RealUnitRegistrationResponseDto> {
    this.validateRegistration(dto);

    if (!this.verifySignature(dto)) {
      throw new BadRequestException('Invalid EIP-712 signature');
    }

    return this.sendRegistrationToAktionariat(dto);
  }

  private validateRegistration(dto: RealUnitUserRegistrationDto): void {
    if (!dto.swissTaxResidence && (!dto.countryAndTINs || dto.countryAndTINs.length === 0)) {
      throw new BadRequestException('countryAndTINs is required when swissTaxResidence is false');
    }

    if (dto.swissTaxResidence && dto.countryAndTINs && dto.countryAndTINs.length > 0) {
      throw new BadRequestException('countryAndTINs should be empty when swissTaxResidence is true');
    }
  }

  private verifySignature(dto: RealUnitUserRegistrationDto): boolean {
    return verifyEIP712Signature(dto);
  }

  private async sendRegistrationToAktionariat(
    dto: RealUnitUserRegistrationDto,
  ): Promise<RealUnitRegistrationResponseDto> {
    try {
      const response = await this.http.post<AktionariatRegistrationResponse>(this.apiUrl, dto, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        tryCount: 3,
        retryDelay: 1000,
      });

      return {
        success: response.success,
        registrationId: response.registrationId,
        error: response.success ? undefined : response.message,
      };
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Registration failed';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
