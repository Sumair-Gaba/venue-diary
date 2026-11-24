// Venue Diary — consumer app design tokens. Warm, wedding-grade palette:
// rosewood primary + gold highlights on a soft paper shell; reels are dark so
// the photos pop. Keep this the single source of truth for colour/spacing.
export const C = {
  bg: '#FFFFFF',
  paper: '#F7F3EE',
  card: '#FFFFFF',
  text: '#1C1620',
  muted: '#8B8698',
  line: '#ECE6DF',
  primary: '#A6324F',      // rosewood
  primaryDark: '#7E2239',
  gold: '#C79A4B',
  wa: '#25D366',
  dark: '#0D0B11',         // reels background
  white: '#FFFFFF',
};
export const R = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };
export const S = (n) => n * 4;   // 4-pt spacing scale
export const F = {
  h1: { fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: '700' },
  body: { fontSize: 14.5 },
  small: { fontSize: 12.5 },
};
