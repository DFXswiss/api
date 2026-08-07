// Thrown by a handler when the job is unworkable from its input alone (broken payload,
// missing precondition). Any other error is treated as transient and retried.
export class JobDeadLetterException extends Error {}
