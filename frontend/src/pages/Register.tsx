import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import toast from 'react-hot-toast';

// Only these self-serve tiers route to Paystack after signup.
const SELF_SERVE_PLANS = ['growth', 'scale'];

const registerSchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
  adminName: z.string().min(2, 'Your name must be at least 2 characters'),
  adminEmail: z.string().email('Invalid email address'),
  adminPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Must contain at least one special character'),
});

type RegisterFormData = z.infer<typeof registerSchema>;

export const Register: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedPlan = searchParams.get('plan')?.toLowerCase();
  const { registerTenant, isLoading } = useAuthStore();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  // Pricing-first guard: registration requires a chosen self-serve tier. Anyone
  // landing here without one (bare /register, or ?plan=enterprise) is sent to
  // pricing to pick a plan, so no signup can bypass plan selection.
  useEffect(() => {
    if (!selectedPlan || !SELF_SERVE_PLANS.includes(selectedPlan)) {
      navigate('/pricing', { replace: true });
    }
  }, [selectedPlan, navigate]);

  const onSubmit = async (data: RegisterFormData) => {
    try {
      // Pricing-first: carry the chosen tier so the tenant lands `pending`.
      const planName = selectedPlan && SELF_SERVE_PLANS.includes(selectedPlan) ? selectedPlan : undefined;
      await registerTenant({ ...data, planName });

      // Payment is collected at the END of onboarding (final step), so the tenant
      // fills in their business details before being charged. They land `pending`
      // on the chosen tier and activate from the onboarding "Done" step.
      navigate('/onboarding');
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Registration failed';
      toast.error(message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">COD Admin</h1>
          <p className="text-gray-600 mt-2">Create your company account</p>
        </div>
        <Card>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Company Name"
              {...register('companyName')}
              error={errors.companyName?.message}
              placeholder="Acme Deliveries Ltd."
            />
            <Input
              label="Your Full Name"
              {...register('adminName')}
              error={errors.adminName?.message}
              placeholder="Jane Doe"
            />
            <Input
              label="Email"
              type="email"
              {...register('adminEmail')}
              error={errors.adminEmail?.message}
              placeholder="jane@acme.com"
            />
            <Input
              label="Password"
              type="password"
              {...register('adminPassword')}
              error={errors.adminPassword?.message}
              placeholder="Min 8 chars: upper, lower, number, special"
            />
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              isLoading={isLoading}
            >
              Create Account
            </Button>
          </form>
          <p className="text-center text-sm text-gray-600 mt-4">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 hover:underline">
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
};
