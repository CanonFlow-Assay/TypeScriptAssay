type Outcome =
  | { readonly kind: 'ok'; readonly value: string }
  | { readonly kind: 'error'; readonly reason: string };
export const render = (outcome: Outcome): string => {
  switch (outcome.kind) {
    case 'ok':
      return outcome.value;
    case 'error':
      return outcome.reason;
  }
};
