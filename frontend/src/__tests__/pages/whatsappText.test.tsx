import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderWhatsAppText } from '../../pages/messages/whatsappText';

const html = (text: string) => {
  const { container } = render(<div>{renderWhatsAppText(text)}</div>);
  return container.innerHTML;
};

describe('WhatsApp bold (T51)', () => {
  it('renders *text* as bold and keeps the rest as it is', () => {
    expect(html('Hello Manny,\n*Package:* 2 sets\n*Order number:* #55')).toBe('<div>Hello Manny,\n<strong>Package:</strong> 2 sets\n<strong>Order number:</strong> #55</div>');
  });

  it('leaves asterisks that touch a space, empty pairs and runs across lines alone', () => {
    expect(html('5 * 3 * 2')).toBe('<div>5 * 3 * 2</div>');
    expect(html('** and * x*')).toBe('<div>** and * x*</div>');
    expect(html('*a\nb*')).toBe('<div>*a\nb*</div>');
  });

  it('never turns text into markup', () => {
    expect(html('*<b>x</b>*')).toBe('<div><strong>&lt;b&gt;x&lt;/b&gt;</strong></div>');
  });
});
