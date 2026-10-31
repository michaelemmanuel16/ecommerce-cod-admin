/** Shared by the reset-password and accept-invite pages. */
// F-121: at least 8 characters with upper case, lower case, a digit and a special character.
export const RULES = [
  { id: 'len', text: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { id: 'upper', text: 'One upper case letter', test: (v: string) => /[A-Z]/.test(v) },
  { id: 'lower', text: 'One lower case letter', test: (v: string) => /[a-z]/.test(v) },
  { id: 'digit', text: 'One number', test: (v: string) => /[0-9]/.test(v) },
  { id: 'special', text: 'One special character', test: (v: string) => /[!@#$%^&*(),.?":{}|<>]/.test(v) },
];

export interface NewPasswordErrors { password?: string; confirm?: string }

/** The two field errors of a new-password form; both undefined when the form may be sent. */
export const validateNewPassword = (password: string, confirm: string): NewPasswordErrors => ({
  password: RULES.every((r) => r.test(password)) ? undefined : 'The password does not meet the rules below',
  confirm: password === confirm ? undefined : 'Passwords do not match',
});
