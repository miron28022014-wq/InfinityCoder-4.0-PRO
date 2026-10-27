/**
 * Типизированные ошибки ядра. Каждая несёт HTTP-статус и стабильный код,
 * чтобы клиенты (Windows/Android/Web) реагировали одинаково.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Требуется авторизация') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Недостаточно прав', details: Record<string, unknown> = {}) {
    super(403, 'FORBIDDEN', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Объект не найден', details: Record<string, unknown> = {}) {
    super(404, 'NOT_FOUND', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(409, 'CONFLICT', message, details);
  }
}

export class PathTraversalError extends AppError {
  constructor(message = 'Недопустимый путь') {
    super(400, 'PATH_TRAVERSAL', message);
  }
}

/**
 * Локальный режим: облачный вызов заблокирован маршрутизатором.
 * Отдельный код, чтобы UI мог показать честный статус вместо общей ошибки.
 */
export class LocalModeBlockedError extends AppError {
  constructor(provider: string, details: Record<string, unknown> = {}) {
    super(403, 'LOCAL_MODE_BLOCKED', `Облачный провайдер «${provider}» недоступен в локальном режиме`, {
      provider,
      ...details,
    });
  }
}

export class UpstreamError extends AppError {
  constructor(provider: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(502, 'UPSTREAM_ERROR', `Провайдер «${provider}» вернул ошибку: ${message}`, {
      provider,
    });
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterMs: number) {
    super(429, 'RATE_LIMITED', 'Слишком много запросов', { retryAfterMs });
  }
}
