export interface Clock {
  readonly now: () => Date;
}
export const decide = (clock: Clock): number => clock.now().getUTCFullYear();
