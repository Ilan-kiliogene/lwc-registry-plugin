declare module '*.md' {
  const messages: {
    getMessage: (key: string, args?: string[]) => string;
  };
  export default messages;
}
