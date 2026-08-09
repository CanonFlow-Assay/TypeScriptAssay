import { clock } from '../adapters/clock.js';
export const decide = (): number => clock.now().getUTCFullYear();
