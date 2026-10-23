import React from 'react';
import { XCircle } from 'lucide-react';
import { PublicScreen, SupportLine } from './PublicScreen';

interface FormNotAvailableProps {
  supportWhatsapp?: string | null;
  /** Embed widget refused by the form's allowed-hosts list. */
  message?: string;
  embedded?: boolean;
}

/** The form is missing, switched off or archived. No link to the admin app. */
export const FormNotAvailable: React.FC<FormNotAvailableProps> = ({ supportWhatsapp, message = 'This form is not available.', embedded }) => (
  <PublicScreen embedded={embedded}>
    <div className="flex justify-center mb-4">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
        <XCircle className="w-9 h-9 text-gray-500" aria-hidden="true" />
      </div>
    </div>
    <h1 className="text-xl font-bold text-gray-900">{message}</h1>
    <SupportLine supportWhatsapp={supportWhatsapp} lead="Need help?" />
  </PublicScreen>
);
