import React from 'react';
import { Link2, Check, Code2 } from 'lucide-react';
import { Button } from '../ui-v2';
import { buildWidgetSnippet, formUrl, EmbedSnippetForm } from '../../lib/embedSnippet';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

interface CopyURLButtonProps {
  form: EmbedSnippetForm;
  variant?: 'primary' | 'secondary';
  label?: string;
  title?: string;
}

export const CopyURLButton: React.FC<CopyURLButtonProps> = ({
  form,
  variant = 'secondary',
  label,
  title = 'Copy public form URL',
}) => {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Button
      type="button"
      variant={variant === 'primary' ? 'primary' : 'default'}
      title={title}
      onClick={() => copy(formUrl(form.slug))}
    >
      {copied ? (
        <Check className="w-4 h-4" />
      ) : (
        <Link2 className="w-4 h-4" />
      )}
      {label && <span className="ml-1">{copied ? 'Copied' : label}</span>}
    </Button>
  );
};

interface CopyEmbedButtonProps {
  form: EmbedSnippetForm;
  variant?: 'primary' | 'secondary';
  label?: string;
  title?: string;
}

export const CopyEmbedButton: React.FC<CopyEmbedButtonProps> = ({
  form,
  variant = 'secondary',
  label,
  title = 'Copy <script> embed snippet',
}) => {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Button
      type="button"
      variant={variant === 'primary' ? 'primary' : 'default'}
      title={title}
      onClick={() => copy(buildWidgetSnippet(form))}
    >
      {copied ? (
        <Check className="w-4 h-4" />
      ) : (
        <Code2 className="w-4 h-4" />
      )}
      {label && <span className="ml-1">{copied ? 'Copied' : label}</span>}
    </Button>
  );
};
