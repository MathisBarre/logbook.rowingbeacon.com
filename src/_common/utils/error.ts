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
