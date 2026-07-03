import { CustomDecorator, SetMetadata } from '@nestjs/common';

// Metadata key marking an endpoint a mail-origin staff token (tfaRequired) may reach BEFORE completing 2FA.
// Shared between the decorator and TfaEnforcementInterceptor so the marker and its reader can never drift.
export const AllowTfaPendingKey = 'allowTfaPending';

// Marks the 2FA-completion endpoints (see AuthController) as reachable by a not-yet-verified mail-origin staff
// token. The global TfaEnforcementInterceptor skips its STRICT-2FA enforcement on any handler or controller
// carrying this marker; without it a tfaRequired token could never reach the flow that clears the marker.
export const AllowTfaPending = (): CustomDecorator => SetMetadata(AllowTfaPendingKey, true);
