// e-tir Gateway Design System

export const Colors = {
  // Base surfaces
  bg: '#0D1117',
  surface: '#161B22',
  card: '#1C2333',
  cardHover: '#21293A',
  border: '#30363D',
  borderSubtle: '#21262D',

  // Brand accent
  primary: '#2F81F7',
  primaryDark: '#1F6FEB',
  primaryLight: '#58A6FF',
  primaryGlow: 'rgba(47, 129, 247, 0.15)',

  // Semantic
  success: '#3FB950',
  successBg: 'rgba(63, 185, 80, 0.1)',
  warning: '#D29922',
  warningBg: 'rgba(210, 153, 34, 0.12)',
  danger: '#F85149',
  dangerBg: 'rgba(248, 81, 73, 0.1)',
  info: '#58A6FF',
  infoBg: 'rgba(88, 166, 255, 0.1)',

  // Text
  textPrimary: '#E6EDF3',
  textSecondary: '#8B949E',
  textMuted: '#484F58',
  textInverse: '#0D1117',

  // Status colors
  statusLoaded: '#58A6FF',
  statusDispatched: '#D2A8FF',
  statusInTransit: '#79C0FF',
  statusCustomsClearance: '#D29922',
  statusCustomsPending: '#E3B341',
  statusArrived: '#3FB950',
  statusDetained: '#F85149',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  section: 40,
};

export const FontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 28,
  display: 34,
};

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const BorderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  xxl: 24,
  full: 999,
};

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
  },
};
