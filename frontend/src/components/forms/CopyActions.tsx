import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Check, Code2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { buildEmbedSnippet, formUrl, EmbedSnippetForm } from '../../lib/embedSnippet';

const COPIED_FEEDBACK_MS = 2000;

const useCopyToClipboard = () => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  }, []);

  return { copied, copy };
};

interface CopyURLButtonProps {
  form: EmbedSnippetForm;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
  label?: string;
  title?: string;
}

export const CopyURLButton: React.FC<CopyURLButtonProps> = ({
  form,
  size = 'sm',
  variant = 'secondary',
  label,
  title = 'Copy public form URL',
}) => {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
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
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
  label?: string;
  title?: string;
}

export const CopyEmbedButton: React.FC<CopyEmbedButtonProps> = ({
  form,
  size = 'sm',
  variant = 'secondary',
  label,
  title = 'Copy <script> embed snippet',
}) => {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      title={title}
      onClick={() => copy(buildEmbedSnippet(form))}
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
