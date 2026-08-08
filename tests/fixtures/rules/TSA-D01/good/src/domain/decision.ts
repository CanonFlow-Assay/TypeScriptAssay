export type Decision =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'rejected'; readonly reason: string };
export const decide = (valid: boolean): Decision =>
  valid ? { kind: 'accepted' } : { kind: 'rejected', reason: 'invalid' };
