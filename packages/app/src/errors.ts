const isObjectValue = <TValue>(
  value: TValue
): value is TValue & (object | null) => typeof value === "object";
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

const isForwardableErrorCode = (
  code: unknown
): code is Exclude<ErrorCode, "INTERNAL_SERVER_ERROR"> =>
  code === "BAD_REQUEST" ||
  code === "UNAUTHORIZED" ||
  code === "FORBIDDEN" ||
  code === "NOT_FOUND" ||
  code === "CONFLICT" ||
  code === "INCOMPATIBLE_VERSION" ||
  code === "UNAVAILABLE";

export const appError = (cause: unknown): AppError => {
  if (cause instanceof AppError) {
    return cause;
  }
  if (cause instanceof Error && cause.name === "AbortError") {
    return new AppError("UNAVAILABLE", "App connection interrupted");
  }
  if (
    cause &&
    isObjectValue(cause) &&
    "code" in cause &&
    cause.code === "NETWORK_ERROR"
  ) {
    return new AppError("UNAVAILABLE", "App connection interrupted");
  }
  if (
    cause &&
    isObjectValue(cause) &&
    "code" in cause &&
    isForwardableErrorCode(cause.code)
  ) {
    return new AppError(
      cause.code,
      "message" in cause ? String(cause.message) : String(cause.code)
    );
  }
  return new AppError("INTERNAL_SERVER_ERROR", "App function failed");
};
