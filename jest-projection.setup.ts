// Turns the projection guard on for every spec in this configuration.
//
// A projected query that answers with a column it did not select is the defect this suite exists
// to catch, and it is silent by nature. The guard makes it throw. Installing it here rather than
// per spec is deliberate: a spec written later would otherwise lose the protection without anything
// saying so.
import { installProjectionGuard } from './src/shared/utils/projection-test.util';

installProjectionGuard();
