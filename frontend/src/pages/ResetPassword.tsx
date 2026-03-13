import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { authService } from '../services/auth.service';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Must contain at least one number')
      .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Must contain at least one special character'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
  });

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full">
          <Card>
            <div className="text-center space-y-4">
              <p className="text-red-600">Invalid reset link. No token provided.</p>
              <Link to="/forgot-password" className="text-sm text-blue-600 hover:underline block">
                Request a new reset link
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const onSubmit = async (data: ResetPasswordFormData) => {
    setErrorMessage('');
    setIsLoading(true);
    try {
      await authService.resetPassword(token, data.password);
      navigate('/login', { state: { message: 'Password reset successful. Please log in with your new password.' } });
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Something went wrong. Please try again.';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">COD Admin</h1>
          <p className="text-gray-600 mt-2">Set a new password</p>
        </div>
        <Card>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {errorMessage && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded" role="alert">
                <span>{errorMessage}</span>
                {errorMessage.includes('expired') && (
                  <Link to="/forgot-password" className="block mt-2 text-sm text-blue-600 hover:underline">
                    Request a new reset link
                  </Link>
                )}
              </div>
            )}
            <Input
              label="New Password"
              type="password"
              {...register('password')}
              error={errors.password?.message}
              placeholder="Enter new password"
            />
            <Input
              label="Confirm Password"
              type="password"
              {...register('confirmPassword')}
              error={errors.confirmPassword?.message}
              placeholder="Confirm new password"
            />
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              isLoading={isLoading}
            >
              Reset Password
            </Button>
          </form>
          <p className="text-center text-sm text-gray-600 mt-4">
            <Link to="/login" className="text-blue-600 hover:underline">
              Back to login
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
};
