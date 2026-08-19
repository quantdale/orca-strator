import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DomainError, type ApiErrorEnvelope } from '@orca/shared';

export function errorHandler(
  error: FastifyError | DomainError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (error instanceof DomainError) {
    reply.status(error.statusCode).send(error.toEnvelope());
    return;
  }

  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
    const response: ApiErrorEnvelope = {
      error: {
        code: 'BAD_REQUEST',
        message: fastifyError.message
      }
    };
    reply.status(fastifyError.statusCode).send(response);
    return;
  }

  request.log.error(error, 'Unhandled server error');
  const response: ApiErrorEnvelope = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal server error occurred.'
    }
  };
  reply.status(500).send(response);
}
