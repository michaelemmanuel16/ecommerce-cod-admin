import { z } from 'zod';

/** A whole number above zero, read from a query string or a JSON body. */
export const positiveInt = z.coerce.number().int().positive();
