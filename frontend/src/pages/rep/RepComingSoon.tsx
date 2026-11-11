import React from 'react';

export const RepComingSoon: React.FC<{ title: string }> = ({ title }) => {
  return (
    <div className="rep-coming-soon" data-testid="rep-coming-soon">
      <div className="head">
        <div>
          <h1>{title}</h1>
          <p>Coming in this release</p>
        </div>
      </div>
      <div
        className="card"
        style={{
          padding: '36px 20px',
          textAlign: 'center',
          color: 'var(--ink-2)',
          marginTop: 16,
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 600 }}>Coming in this release</p>
        <p style={{ color: 'var(--ink-3)', marginTop: 6, fontSize: 13 }}>
          This page is scheduled for release in the upcoming update.
        </p>
      </div>
    </div>
  );
};

export default RepComingSoon;
