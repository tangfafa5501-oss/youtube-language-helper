declare module 'sbd' {
  const sbd: {
    sentences(text: string, options?: {
      newline_boundaries?: boolean;
      html_boundaries?: boolean;
      sanitize?: boolean;
      preserve_whitespace?: boolean;
    }): string[];
  };
  export default sbd;
}
