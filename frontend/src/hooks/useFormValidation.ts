import { useForm, UseFormProps, FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

/**
 * Custom hook that wraps react-hook-form with Zod validation
 *
 * @example
 * ```tsx
 * const { register, handleSubmit, formState: { errors } } = useFormValidation({
 *   schema: loginSchema,
 *   defaultValues: { email: '', password: '' }
 * });
 *
 * const onSubmit = async (data: LoginFormData) => {
 *   await login(data);
 * };
 * ```
 */
export function useFormValidation<
  TFieldValues extends FieldValues = FieldValues,
  TContext = any
>(
  props: UseFormProps<TFieldValues, TContext> & {
    schema: z.ZodSchema<TFieldValues>;
  }
) {
  const { schema, ...formProps } = props;

  return useForm<TFieldValues, TContext>({
    ...formProps,
    resolver: zodResolver(schema),
  });
}

/**
 * Helper to extract error message from react-hook-form FieldError
 */
export function getErrorMessage(
  error?: { message?: string }
): string | undefined {
  return error?.message;
}

/**
 * Check if a field has an error
 */
export function hasError(
  errors: Record<string, any>,
  fieldName: string
): boolean {
  return !!errors[fieldName];
}

/**
 * Get nested error message from form state
 * Useful for nested objects like address.street
 */
export function getNestedError(
  errors: Record<string, any>,
  path: string
): string | undefined {
  const keys = path.split('.');
  let current = errors;

  for (const key of keys) {
    if (!current[key]) return undefined;
    current = current[key];
  }

  return current?.message;
}
