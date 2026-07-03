import { CustomDecorator, SetMetadata } from '@nestjs/common';

// Metadata key marking an endpoint a mail-origin staff token (tfaRequired) may reach BEFORE completing 2FA.
// Shared between the decorator and TfaEnforcementInterceptor so the marker and its reader can never drift.
export const AllowTfaPendingKey = 'allowTfaPending';

// Marks an endpoint reachable by a not-yet-verified mail-origin staff token (tfaRequired). The global
// TfaEnforcementInterceptor skips its STRICT-2FA enforcement on any handler/controller carrying this marker.
// Two categories qualify: (1) the 2FA-completion endpoints (auth 2fa), without which a tfaRequired token could
// never clear its marker; (2) non-staff-privileged own-account reads (e.g. the /user session bootstrap), which
// expose no staff data and must load so the staff session can start and then hit 2FA on its first staff action.
// Never mark a staff-privileged route with this.
export const AllowTfaPending = (): CustomDecorator => SetMetadata(AllowTfaPendingKey, true);
