import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  code: string | null;
  details: any | null;
  isOperational: boolean;
  timestamp: string;
  constructor(message: string, statusCode?: number, code?: string | null, details?: any | null);
}

export class ValidationError extends AppError {
  field: string | null;
  value: any | null;
  constructor(message: string, field?: string | null, value?: any | null);
}

export class AuthenticationError extends AppError {
  constructor(message?: string);
}

export class AuthorizationError extends AppError {
  constructor(message?: string);
}

export class NotFoundError extends AppError {
  constructor(resource?: string);
}

export class ConflictError extends AppError {
  resource: string | null;
  constructor(message: string, resource?: string | null);
}

export class DatabaseError extends AppError {
  constructor(message: string, operation?: string | null);
}

export class BusinessLogicError extends AppError {
  constructor(message: string, rule?: string | null);
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): Response;
export function notFoundHandler(req: Request, res: Response): void;
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): (req: Request, res: Response, next: NextFunction) => void;
export function createErrorResponse(message: string, code?: string | null, details?: any | null): {
  success: boolean;
  error: {
    message: string;
    code: string | null;
    details: any | null;
  };
  timestamp: string;
};
