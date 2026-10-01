export type StatusCodeError = {
  status?: number;
  statusCode?: number;
  code?: number;
};

export function getStatusCode(error: StatusCodeError): number | undefined {
  return error?.code ?? error?.status ?? error?.statusCode;
}
