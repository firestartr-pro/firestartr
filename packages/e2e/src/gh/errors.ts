import { getStatusCode } from '../errors/status-code';

export type GithubError = {
  status?: number;
  statusCode?: number;
  response?: {
    status?: number;
    statusCode?: number;
  };
  message?: string;
};

export function isNotFound(error: GithubError): boolean {
  if (getStatusCode(error) === 404) return true;
  const message = error.message ?? '';
  return message.toLowerCase().includes('not found');
}
