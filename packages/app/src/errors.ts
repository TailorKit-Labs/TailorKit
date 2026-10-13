export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INCOMPATIBLE_VERSION"
  | "UNAVAILABLE"
  | "INTERNAL_SERVER_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string = code) {
    super(message);
    this.code = code;

    this.name = "AppError";
  }
}

export const appError = (error: unknown): AppError => {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AppError("UNAVAILABLE", "App connection interrupted");
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "NETWORK_ERROR"
  ) {
    return new AppError("UNAVAILABLE", "App connection interrupted");
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    [
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "INCOMPATIBLE_VERSION",
      "UNAVAILABLE",
    ].includes(String(error.code))
  ) {
    return new AppError(
      error.code as ErrorCode,
      "message" in error ? String(error.message) : String(error.code)
    );
  }
  return new AppError("INTERNAL_SERVER_ERROR", "App function failed");
};
