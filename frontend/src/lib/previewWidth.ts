export type PreviewDevice = 'mobile' | 'desktop';

/** The width the form is drawn at in the preview (F-419). A narrower pane scales the drawing down to fit. */
export const PREVIEW_WIDTH: Record<PreviewDevice, number> = { mobile: 390, desktop: 1024 };
