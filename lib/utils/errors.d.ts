export declare class AuthError extends Error {
    code: 'token_expired' | 'token_invalid' | 'no_token';
    constructor(code: 'token_expired' | 'token_invalid' | 'no_token', message: string);
}
