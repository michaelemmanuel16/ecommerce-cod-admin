import React from 'react';
import { BULK_MERGE_TAGS } from './mergeTags';

interface MergeTagToolbarProps {
  onInsert: (token: string) => void;
}

export const MergeTagToolbar: React.FC<MergeTagToolbarProps> = ({ onInsert }) => (
  <div className="flex flex-wrap gap-2">
    {BULK_MERGE_TAGS.map(({ tag, label }) => (
      <button
        key={tag}
        type="button"
        onClick={() => onInsert(`{{${tag}}}`)}
        title={`Insert ${label}`}
        className="px-2 py-1 text-xs font-mono rounded border border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100 hover:border-gray-400"
      >
        {`{{${tag}}}`}
      </button>
    ))}
  </div>
);
