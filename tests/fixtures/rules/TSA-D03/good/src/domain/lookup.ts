export const lookup = (key: string, values: Record<string, string>): string | undefined => {
  if (key in values) return values[key];
  return undefined;
};
