export type ErrorCode =
  | "VALIDATION_ERROR"
  | "REPOSITORY_NOT_FOUND"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR"
  | "DATABASE_ERROR";

export interface FieldError {
  field?: string;
  message: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: FieldError[];
  };
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: FieldError[];

  constructor(code: ErrorCode, message: string, statusCode: number = 400, details?: FieldError[]) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toEnvelope(): ApiErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && this.details.length > 0 ? { details: this.details } : {})
      }
    };
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: FieldError[]) {
    super("VALIDATION_ERROR", message, 422, details);
    this.name = "ValidationError";
  }
}

export class RepositoryNotFoundError extends DomainError {
  constructor(id: string) {
    super("REPOSITORY_NOT_FOUND", `Repository with ID "${id}" not found.`, 404);
    this.name = "RepositoryNotFoundError";
  }
}

export class BadRequestError extends DomainError {
  constructor(message: string, details?: FieldError[]) {
    super("BAD_REQUEST", message, 400, details);
    this.name = "BadRequestError";
  }
}

export class DatabaseError extends DomainError {
  constructor(message: string) {
    super("DATABASE_ERROR", message, 500);
    this.name = "DatabaseError";
  }
}

export class InternalError extends DomainError {
  constructor(message: string = "An internal server error occurred.") {
    super("INTERNAL_ERROR", message, 500);
    this.name = "InternalError";
  }
}
