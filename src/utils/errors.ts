export class AuthError extends Error {
  public constructor(
    public code: 'token_expired' | 'token_invalid' | 'no_token',
    message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
