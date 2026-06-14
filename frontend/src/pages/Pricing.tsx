import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Public pricing page (MAN-61) — limits-only tier ladder. Growth and Scale are the
 * same product; the only difference is the ceiling. The design solves the
 * "identical tiers" problem with a difference-first table (the 5 caps + one
 * all-modules row), stacking into per-tier cards below md. NGN, sky-blue accent.
 */

interface Tier {
  name: 'growth' | 'scale' | 'enterprise';
  displayName: string;
  price: string;
  popular?: boolean;
  cta: string;
  ctaLink: string;
}

const TIERS: Tier[] = [
  { name: 'growth', displayName: 'Growth', price: '₦10,000', popular: true, cta: 'Start with Growth', ctaLink: '/register?plan=growth' },
  { name: 'scale', displayName: 'Scale', price: '₦20,000', cta: 'Start with Scale', ctaLink: '/register?plan=scale' },
  { name: 'enterprise', displayName: 'Enterprise', price: "Let's talk", cta: 'Contact us', ctaLink: '/register?plan=enterprise' },
];

// Rows are ONLY the things that differ between tiers, plus the "everything included" row.
const CAP_ROWS: { label: string; values: Record<Tier['name'], string> }[] = [
  { label: 'Orders / month', values: { growth: '5,000', scale: 'Unlimited', enterprise: 'Unlimited' } },
  { label: 'Staff accounts', values: { growth: '10', scale: 'Unlimited', enterprise: 'Unlimited' } },
  { label: 'Products', values: { growth: '5', scale: 'Unlimited', enterprise: 'Unlimited' } },
  { label: 'Delivery agents', values: { growth: '10', scale: 'Unlimited', enterprise: 'Unlimited' } },
  { label: 'Checkout forms', values: { growth: '5', scale: 'Unlimited', enterprise: 'Unlimited' } },
];

const INCLUDED_MODULES =
  'Orders & COD · CRM · Inventory · Delivery agents + app · Cart recovery · Paystack + COD · ' +
  'Email + SMS alerts · Finance & accounting · Reps & commissions · Workflows · Bulk WhatsApp + SMS · ' +
  'Meta pixel / CAPI · API access · Advanced reports + CSV · Priority support';

export function Pricing() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <span className="text-xl font-extrabold text-primary-600">CodAdmin</span>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900">Log in</Link>
            <Link
              to="/register"
              className="text-sm font-semibold bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-8">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">One toolkit. Pick your ceiling.</h1>
        <p className="mt-3 text-gray-600 text-lg max-w-2xl">
          Growth and Scale are the same product with every feature. The only difference is how high you can go.
        </p>
      </header>

      {/* Difference-first table (md+) */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <div className="hidden md:block overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="p-5 w-1/3" />
                {TIERS.map((t) => (
                  <th key={t.name} className="p-5 align-bottom">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{t.displayName}</span>
                      {t.popular && (
                        <span className="px-2 py-0.5 rounded-full bg-primary-600 text-white text-[11px] font-semibold">
                          Most popular
                        </span>
                      )}
                    </div>
                    <div className="text-2xl font-extrabold mt-1">
                      {t.price}
                      {t.name !== 'enterprise' && <span className="text-sm font-normal text-gray-500">/mo</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-sm">
              {CAP_ROWS.map((row, i) => (
                <tr key={row.label} className={`border-b border-gray-100 ${i % 2 ? 'bg-gray-50/50' : ''}`}>
                  <td className="p-5 font-medium text-gray-700">{row.label}</td>
                  <td className="p-5 font-bold text-primary-700">{row.values.growth}</td>
                  <td className="p-5 font-bold">{row.values.scale}</td>
                  <td className="p-5 font-bold">{row.values.enterprise}</td>
                </tr>
              ))}
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <td className="p-5 font-medium text-gray-700">
                  All feature modules
                  <div className="text-xs text-gray-400 font-normal">CRM, accounting, workflows, marketing, API…</div>
                </td>
                <td className="p-5 font-semibold text-primary-700">Included</td>
                <td className="p-5 font-semibold text-primary-700">Included</td>
                <td className="p-5 font-semibold text-primary-700">Included</td>
              </tr>
              <tr>
                <td className="p-5 font-medium text-gray-700">Custom integrations · manager · SLA</td>
                <td className="p-5 text-gray-400">—</td>
                <td className="p-5 text-gray-400">—</td>
                <td className="p-5 font-semibold text-primary-700">Included</td>
              </tr>
              <tr className="border-t border-gray-200">
                <td className="p-5" />
                {TIERS.map((t) => (
                  <td key={t.name} className="p-5">
                    <Link
                      to={t.ctaLink}
                      className={`block text-center min-h-[44px] py-2.5 rounded-lg font-semibold ${
                        t.popular
                          ? 'bg-primary-600 text-white hover:bg-primary-700'
                          : t.name === 'enterprise'
                            ? 'border border-gray-300 hover:bg-gray-50'
                            : 'bg-gray-900 text-white hover:bg-black'
                      }`}
                    >
                      {t.cta}
                    </Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile: per-tier cards (no horizontal-scroll table) */}
        <div className="md:hidden space-y-5">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`rounded-2xl bg-white p-6 ${t.popular ? 'border-2 border-primary-600 shadow-lg' : 'border border-gray-200'}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg">{t.displayName}</span>
                {t.popular && (
                  <span className="px-2 py-0.5 rounded-full bg-primary-600 text-white text-[11px] font-semibold">
                    Most popular
                  </span>
                )}
              </div>
              <div className="text-2xl font-extrabold mt-1">
                {t.price}
                {t.name !== 'enterprise' && <span className="text-sm font-normal text-gray-500">/mo</span>}
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                {CAP_ROWS.map((row) => (
                  <div key={row.label} className="flex justify-between">
                    <dt className="text-gray-500">{row.label}</dt>
                    <dd className="font-semibold">{row.values[t.name]}</dd>
                  </div>
                ))}
                <div className="flex justify-between">
                  <dt className="text-gray-500">All feature modules</dt>
                  <dd className="font-semibold text-primary-700">Included</dd>
                </div>
              </dl>
              <Link
                to={t.ctaLink}
                className={`mt-5 block text-center min-h-[44px] py-2.5 rounded-lg font-semibold ${
                  t.popular
                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                    : t.name === 'enterprise'
                      ? 'border border-gray-300 hover:bg-gray-50'
                      : 'bg-gray-900 text-white hover:bg-black'
                }`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-4 text-sm text-gray-500">
          Not sure? If you do under ~5,000 orders a month, Growth is everything you need. Cross that line and Scale removes every ceiling.
        </p>
      </section>

      {/* Shared "everything included" strip */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="rounded-2xl bg-white border border-gray-200 p-6">
          <div className="text-sm font-semibold text-gray-900">Every plan includes the full toolkit</div>
          <p className="mt-2 text-sm text-gray-600">{INCLUDED_MODULES}</p>
        </div>
      </section>
    </div>
  );
}
