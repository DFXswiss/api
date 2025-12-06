import { verifyTypedData } from 'ethers/lib/utils';
import { RealUnitUserRegistrationDto } from '../dto/realunit-registration.dto';

const EIP712_DOMAIN = {
  name: 'RealUnitUser',
  version: '1',
};

const EIP712_TYPES = {
  RealUnitUserRegistration: [
    { name: 'email', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'phoneNumber', type: 'string' },
    { name: 'birthday', type: 'string' },
    { name: 'nationality', type: 'string' },
    { name: 'addressStreet', type: 'string' },
    { name: 'addressPostalCode', type: 'string' },
    { name: 'addressCity', type: 'string' },
    { name: 'addressCountry', type: 'string' },
    { name: 'swissTaxResidence', type: 'bool' },
    { name: 'registrationDate', type: 'string' },
    { name: 'walletAddress', type: 'address' },
  ],
};

export interface EIP712Message {
  email: string;
  name: string;
  type: string;
  phoneNumber: string;
  birthday: string;
  nationality: string;
  addressStreet: string;
  addressPostalCode: string;
  addressCity: string;
  addressCountry: string;
  swissTaxResidence: boolean;
  registrationDate: string;
  walletAddress: string;
}

export function buildEIP712Message(dto: RealUnitUserRegistrationDto): EIP712Message {
  return {
    email: dto.email,
    name: dto.name,
    type: dto.type,
    phoneNumber: dto.phoneNumber,
    birthday: dto.birthday,
    nationality: dto.nationality,
    addressStreet: dto.addressStreet,
    addressPostalCode: dto.addressPostalCode,
    addressCity: dto.addressCity,
    addressCountry: dto.addressCountry,
    swissTaxResidence: dto.swissTaxResidence,
    registrationDate: dto.registrationDate,
    walletAddress: dto.walletAddress,
  };
}

export function verifyEIP712Signature(dto: RealUnitUserRegistrationDto): boolean {
  try {
    const message = buildEIP712Message(dto);
    const recoveredAddress = verifyTypedData(EIP712_DOMAIN, EIP712_TYPES, message, dto.signature);

    return recoveredAddress.toLowerCase() === dto.walletAddress.toLowerCase();
  } catch {
    return false;
  }
}

export function getEIP712Fields(dto: RealUnitUserRegistrationDto) {
  return {
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    message: buildEIP712Message(dto),
  };
}
