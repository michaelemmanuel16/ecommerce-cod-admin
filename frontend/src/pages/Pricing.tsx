import React from 'react';
import { Link } from 'react-router-dom';

interface PricingTier {
  name: string;
  displayName: string;
  priceGHS: number;
  priceLabel: string;
  maxOrders: string;
  maxUsers: string;
  features: string[];
  cta: string;
  ctaLink: string;
  highlighted: boolean;
  badge?: string;
}

const tiers: PricingTier[] = [
  {
    name: 'free',
    displayName: 'Free',
    priceGHS: 0,
    priceLabel: 'GHS 0',
    maxOrders: '100 orders / month',
    maxUsers: '3 team members',
    features: [
      'Order management',
      'Customer management',
      'Delivery agent tracking',
      'Product & inventory management',
      'Basic reporting',
    ],
    cta: 'Get Started Free',
    ctaLink: '/register',
    highlighted: false,
  },
  {
    name: 'starter',
    displayName: 'Starter',
    priceGHS: 299,
    priceLabel: 'GHS 299 / mo',
    maxOrders: '1,000 orders / month',
    maxUsers: '10 team members',
    features: [
      'Everything in Free',
      'Analytics & reporting',
      'Custom webhooks',
      'Workflow automation',
      'Bulk order import',
      'Email support',
    ],
    cta: 'Start 14-day Trial',
    ctaLink: '/register',
    highlighted: true,
    badge: 'Most Popular',
  },
  {
    name: 'pro',
    displayName: 'Pro',
    priceGHS: 799,
    priceLabel: 'GHS 799 / mo',
    maxOrders: 'Unlimited orders',
    maxUsers: 'Unlimited team members',
    features: [
      'Everything in Starter',
      'REST API access',
      'Priority support (4h SLA)',
      'Advanced analytics',
      'Custom integrations',
      'Dedicated onboarding',
    ],
    cta: 'Start 14-day Trial',
    ctaLink: '/register',
    highlighted: false,
  },
];

const faqItems = [
  {
    q: 'Is there a free trial?',
    a: 'Yes — every new account gets a 14-day free trial of the Pro plan. No credit card required.',
  },
  {
    q: 'What happens when my trial ends?',
    a: 'Your account moves to the Free plan automatically. Your data is never deleted. You can upgrade at any time.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Absolutely. You can upgrade or downgrade your plan at any time from Settings → Billing & Plans.',
  },
  {
    q: 'Which currencies are supported?',
    a: 'CodAdmin supports Ghanaian Cedi (GHS) and Nigerian Naira (NGN). Pricing shown is in GHS.',
  },
  {
    q: 'How is billing handled?',
    a: 'Billing is managed manually — our team will contact you with payment instructions when you upgrade. We accept mobile money and bank transfer.',
  },
];

export function Pricing() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <span className="text-xl font-bold text-indigo-600">CodAdmin</span>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900">
              Log in
            </Link>
            <Link
              to="/register"
              className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-12 text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Simple, transparent pricing
        </h1>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto">
          Manage your COD orders, team, and deliveries — all in one place. Start free, scale as you grow.
        </p>
      </div>

      {/* Pricing cards */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl bg-white border ${
                tier.highlighted
                  ? 'border-indigo-500 shadow-xl ring-2 ring-indigo-500'
                  : 'border-gray-200 shadow-sm'
              } p-8 flex flex-col`}
            >
              {tier.badge && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  {tier.badge}
                </span>
              )}

              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900">{tier.displayName}</h2>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-gray-900">{tier.priceLabel}</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">{tier.maxOrders}</p>
                <p className="text-sm text-gray-500">{tier.maxUsers}</p>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-gray-700">
                    <svg
                      className="w-4 h-4 mt-0.5 text-indigo-500 flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                to={tier.ctaLink}
                className={`block text-center text-sm font-semibold px-4 py-3 rounded-lg transition-colors ${
                  tier.highlighted
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-gray-400 mt-8">
          All plans include a 14-day free Pro trial · No credit card required · Cancel any time
        </p>
      </div>

      {/* FAQ */}
      <div className="bg-white border-t border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">
            Frequently asked questions
          </h2>
          <dl className="space-y-6">
            {faqItems.map(({ q, a }) => (
              <div key={q}>
                <dt className="font-semibold text-gray-900">{q}</dt>
                <dd className="mt-1 text-gray-500 text-sm">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="bg-indigo-600">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">
            Ready to streamline your COD operations?
          </h2>
          <p className="text-indigo-200 mb-6">
            Join hundreds of e-commerce teams across Ghana and Nigeria.
          </p>
          <Link
            to="/register"
            className="inline-block bg-white text-indigo-600 font-semibold px-6 py-3 rounded-lg hover:bg-indigo-50 transition-colors"
          >
            Start for Free
          </Link>
        </div>
      </div>
    </div>
  );
}
