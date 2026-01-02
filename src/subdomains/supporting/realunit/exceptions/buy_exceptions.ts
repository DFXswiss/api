import { BadRequestException } from '@nestjs/common';

export class RegistrationRequiredException extends BadRequestException {
    constructor(message = 'RealUnit registration required') {
        super({
            statusCode: 400,
            error: 'Bad Request',
            code: 'REGISTRATION_REQUIRED',
            message,
        });
    }
}

export class KycLevelRequiredException extends BadRequestException {
    constructor(
        public readonly requiredLevel: number,
        public readonly currentLevel: number,
        message: String,
    ) {
        super({
            statusCode: 400,
            error: 'Bad Request',
            code: 'KYC_LEVEL_REQUIRED',
            message: message,
            requiredLevel,
            currentLevel,
        });
    }
}

