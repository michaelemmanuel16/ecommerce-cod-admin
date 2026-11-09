import React from 'react';

export const RepQueuePage: React.FC = () => {
  return (
    <div className="rep-queue-view" data-testid="rep-queue-page">
      <div className="head">
        <div>
          <h1>Queue</h1>
          <p>Orders waiting for your call.</p>
        </div>
      </div>
    </div>
  );
};

export default RepQueuePage;
