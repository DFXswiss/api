import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CryptoService } from 'src/ain/services/crypto.service';
import { AuthService } from '../auth/auth.service';
import { UserRepository } from '../user/user.repository';
import { UserService } from '../user/user.service';
import { LinkDto } from './dto/link.dto';

@Injectable()
export class LinkService {
  constructor(
    private readonly userService: UserService,
    private readonly cryptoService: CryptoService,
    private readonly authService: AuthService,
  ) {}

  async linkAddressToUser(data: LinkDto, ip: string): Promise<void> {
    const user = await this.userService.getUserByAddress(data.existing.address, true);
    // it doesn't matter what went wrong in our link process, we should always throw the same exception
    // just from a security aspect the best thing we can do, otherwise attackers could brute-force registered addresses
    if (!user) throw new BadRequestException();

    const signingMessageForExisting = this.authService.getSignMessage(data.existing.address);
    const existingSignatureIsValid = this.cryptoService.verifySignature(
      signingMessageForExisting,
      data.existing.address,
      data.existing.signature,
    );

    const signingMessageForLink = this.authService.getSignMessage(data.linkTo.address);
    const linkSignatureIsValid = this.cryptoService.verifySignature(
      signingMessageForLink,
      data.linkTo.address,
      data.linkTo.signature,
    );

    if (!existingSignatureIsValid || !linkSignatureIsValid) throw new BadRequestException();

    let isCreatedOrUpdated = false;
    try {
      isCreatedOrUpdated = await this.userService.createOrUpdateUser(user, data.linkTo, ip);
    } catch (e) {
      console.log(e);
      // maybe we want to log that error somewhere
      throw new BadRequestException();
    }

    if (!isCreatedOrUpdated) throw new BadRequestException();
  }
}
