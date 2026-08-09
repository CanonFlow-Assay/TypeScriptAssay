export const append = (values: ReadonlyArray<string>, next: string): ReadonlyArray<string> => [
  ...values,
  next
];
