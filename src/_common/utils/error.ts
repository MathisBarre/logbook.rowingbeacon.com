export class ErrorWithCode<
  ErrorCode extends string,
  Details = unknown
> extends Error {
  code: ErrorCode;
  details: Details;

  constructor(payload: {
    code: ErrorCode;
    message?: string;
    details?: Details;
  }) {
    super(payload.message || payload.code);
    this.code = payload.code;
    this.details = payload.details as Details;
  }
}

export class TechnicalError extends ErrorWithCode<"TECHNICAL_ERROR"> {
  constructor(error: unknown) {
    super({ code: "TECHNICAL_ERROR", message: getErrorMessage(error) });
  }
}

export type SimpleResult<
  ErrorCode extends string,
  SuccessType,
  Details = unknown
> = ErrorResult<ErrorCode, Details> | SuccessResult<SuccessType>;

type ErrorResult<ErrorCode extends string, Details = unknown> = [
  ErrorWithCode<ErrorCode, Details>,
  null
];
type SuccessResult<SuccessType> = [null, SuccessType];

export const asOk = <SuccessType>(
  result: SuccessType
): SuccessResult<SuccessType> => {
  return [null, result];
};

export const asError = <ErrorCode extends string, Details = unknown>(error: {
  code: ErrorCode;
  message?: string;
  details?: Details;
}): ErrorResult<ErrorCode, Details> => {
  return [new ErrorWithCode(error), null];
};

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof ErrorWithCode) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
};
