/** Shared by the reset-password and accept-invite pages. */
// F-121: at least 8 characters with upper case, lower case, a digit and a special character.
export const RULES = [
  { id: 'len', text: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { id: 'upper', text: 'One upper case letter', test: (v: string) => /[A-Z]/.test(v) },
  { id: 'lower', text: 'One lower case letter', test: (v: string) => /[a-z]/.test(v) },
  { id: 'digit', text: 'One number', test: (v: string) => /[0-9]/.test(v) },
  { id: 'special', text: 'One special character', test: (v: string) => /[!@#$%^&*(),.?":{}|<>]/.test(v) },
];
