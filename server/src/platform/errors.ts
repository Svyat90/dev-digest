/**
 * Domain error taxonomy + structured API error envelope. The UX taxonomy
 * (toast/inline/full-screen) is the frontend's concern; the API returns a
 * stable structured body (ApiErrorBody): { error: { code, message, details } }.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * A missing row, named by entity so every 404 reads the same way:
 * `new NotFoundError('Agent', id)` → "Agent 6f6e… not found".
 */
export class NotFoundError extends AppError {
  constructor(entity = 'Resource', id?: string, details?: unknown) {
    super('not_found', notFoundMessage(entity, id), 400, details);
  }
}

/** "<entity> <id> not found", or "<entity> not found" when the id is unknown. */
export function notFoundMessage(entity: string, id?: string): string {
  return id ? `${entity} ${id} not found` : `${entity} not found`;
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('validation_error', message, 422, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super('external_service_error', message, 502, details);
  }
}

/**
 * The provider answered, but its structured output never matched the schema.
 * Same code and status as ExternalServiceError, so existing callers are unchanged;
 * callers that must tell it apart from a provider failure use `instanceof`.
 */
export class InvalidModelOutputError extends ExternalServiceError {
  constructor(message: string, details?: unknown) {
    super(message, details);
    this.name = 'InvalidModelOutputError';
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_error', message, 500, details);
  }
}
