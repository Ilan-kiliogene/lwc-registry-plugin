export class AuthError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'AuthError';
    }
}
//# sourceMappingURL=errors.js.map