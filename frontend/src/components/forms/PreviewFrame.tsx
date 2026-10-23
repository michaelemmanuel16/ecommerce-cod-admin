import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import { PREVIEW_WIDTH, type PreviewDevice } from '../../lib/previewWidth';

/** Mobile / Desktop switch. */
export const DeviceToggle: React.FC<{ device: PreviewDevice; onChange: (d: PreviewDevice) => void }> = ({ device, onChange }) => (
  <div className="seg" role="group" aria-label="Preview size">
    <button type="button" className={device === 'mobile' ? 'on' : undefined} aria-pressed={device === 'mobile'} onClick={() => onChange('mobile')}>
      <Smartphone size={14} style={{ verticalAlign: -2 }} /> Mobile
    </button>
    <button type="button" className={device === 'desktop' ? 'on' : undefined} aria-pressed={device === 'desktop'} onClick={() => onChange('desktop')}>
      <Monitor size={14} style={{ verticalAlign: -2 }} /> Desktop
    </button>
  </div>
);

interface PreviewFrameProps {
  src: string;
  device: PreviewDevice;
  /** Height of the stage in px. Without it the stage fills its parent. */
  height?: number;
}

/** An iframe drawn at the device width and scaled down to fit the space it has. */
export const PreviewFrame = forwardRef<HTMLIFrameElement, PreviewFrameProps>(({ src, device, height }, ref) => {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: height ?? 0 });

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setSize({ w: el.clientWidth, h: height ?? el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  const width = PREVIEW_WIDTH[device];
  const scale = size.w > 0 ? Math.min(1, size.w / width) : 1;
  const stageHeight = size.h > 0 ? size.h : 640;

  return (
    <div ref={stage} className="pvstage" style={height ? { height } : { height: '100%' }} data-testid="preview-stage">
      <div className="pvclip" style={{ width: width * scale, height: stageHeight }}>
        <iframe
          ref={ref}
          src={src}
          title="Checkout preview"
          data-width={width}
          style={{ width, height: stageHeight / scale, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
});
PreviewFrame.displayName = 'PreviewFrame';
