import type { User } from '../domain/user.js';
export const decode = (_input: unknown): User => ({ name: 'decoded' });
