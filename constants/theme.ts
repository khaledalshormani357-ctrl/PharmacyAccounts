// Smart Pharmacy ERP — Design System v2

export const Colors = {
  // Brand — Pharmacy Green
  primary: '#00875A',
  primaryDark: '#006644',
  primaryLight: '#E3F5EF',
  primaryMid: '#00A372',

  // Secondary — Trust Blue
  secondary: '#0052CC',
  secondaryLight: '#DEEBFF',
  secondaryMid: '#0065FF',

  // Accent — Warm Amber (warnings, credit)
  accent: '#F59E0B',
  accentLight: '#FEF3C7',

  // Semantic
  success: '#00875A',
  successLight: '#E3F5EF',
  warning: '#F59E0B',
  warningLight: '#FFF8E6',
  error: '#DE350B',
  errorLight: '#FFEBE6',
  info: '#0065FF',
  infoLight: '#DEEBFF',
  purple: '#6554C0',
  purpleLight: '#EAE6FF',

  // Light Mode Surfaces
  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceAlt: '#F8F9FA',
  surfaceElevated: '#FFFFFF',
  border: '#DFE1E6',
  borderLight: '#EBECF0',
  divider: '#EBECF0',

  // Dark Mode Surfaces
  backgroundDark: '#0D1117',
  surfaceDark: '#161B22',
  surfaceAltDark: '#21262D',
  surfaceElevatedDark: '#1C2128',
  borderDark: '#30363D',
  dividerDark: '#21262D',

  // Text Light
  textPrimary: '#172B4D',
  textSecondary: '#5E6C84',
  textTertiary: '#8993A4',
  textDisabled: '#C1C7D0',
  textInverse: '#FFFFFF',
  textLink: '#0052CC',

  // Text Dark
  textPrimaryDark: '#E6EDF3',
  textSecondaryDark: '#8B949E',
  textTertiaryDark: '#6E7681',
  textDisabledDark: '#30363D',

  // Financial Semantic Colors
  income: '#00875A',
  expense: '#DE350B',
  credit: '#F59E0B',
  profit: '#00875A',
  loss: '#DE350B',
  neutral: '#5E6C84',

  // Status Colors
  statusOk: '#00875A',
  statusLow: '#F59E0B',
  statusOut: '#DE350B',
  statusExpiring: '#FF8B00',
  statusExpired: '#BF2600',
  statusDead: '#6554C0',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const Radius = {
  xs: 3,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
};

export const FontSize = {
  xs: 11,
  sm: 12,
  base: 14,
  md: 15,
  lg: 17,
  xl: 19,
  xxl: 22,
  xxxl: 26,
  display: 32,
};

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

export const Shadow = {
  xs: {
    shadowColor: '#172B4D',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: '#172B4D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#172B4D',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#172B4D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
  },
};

export const IconSize = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
  xxl: 32,
};

export type ThemeMode = 'light' | 'dark';

export function getTheme(mode: ThemeMode) {
  const isDark = mode === 'dark';
  return {
    isDark,
    colors: {
      primary: Colors.primary,
      primaryDark: Colors.primaryDark,
      primaryLight: Colors.primaryLight,
      primaryMid: Colors.primaryMid,
      secondary: Colors.secondary,
      secondaryLight: Colors.secondaryLight,
      secondaryMid: Colors.secondaryMid,
      accent: Colors.accent,
      accentLight: Colors.accentLight,
      success: Colors.success,
      successLight: Colors.successLight,
      warning: Colors.warning,
      warningLight: Colors.warningLight,
      error: Colors.error,
      errorLight: Colors.errorLight,
      info: Colors.info,
      infoLight: Colors.infoLight,
      purple: Colors.purple,
      purpleLight: Colors.purpleLight,
      background: isDark ? Colors.backgroundDark : Colors.background,
      surface: isDark ? Colors.surfaceDark : Colors.surface,
      surfaceAlt: isDark ? Colors.surfaceAltDark : Colors.surfaceAlt,
      surfaceElevated: isDark ? Colors.surfaceElevatedDark : Colors.surfaceElevated,
      border: isDark ? Colors.borderDark : Colors.border,
      borderLight: isDark ? Colors.borderDark : Colors.borderLight,
      divider: isDark ? Colors.dividerDark : Colors.divider,
      textPrimary: isDark ? Colors.textPrimaryDark : Colors.textPrimary,
      textSecondary: isDark ? Colors.textSecondaryDark : Colors.textSecondary,
      textTertiary: isDark ? Colors.textTertiaryDark : Colors.textTertiary,
      textDisabled: isDark ? Colors.textDisabledDark : Colors.textDisabled,
      textInverse: Colors.textInverse,
      textLink: isDark ? '#4C9AFF' : Colors.textLink,
      income: Colors.income,
      expense: Colors.expense,
      credit: Colors.credit,
      profit: Colors.profit,
      loss: Colors.loss,
      neutral: Colors.neutral,
      statusOk: Colors.statusOk,
      statusLow: Colors.statusLow,
      statusOut: Colors.statusOut,
      statusExpiring: Colors.statusExpiring,
      statusExpired: Colors.statusExpired,
      statusDead: Colors.statusDead,
    },
    spacing: Spacing,
    radius: Radius,
    fontSize: FontSize,
    fontWeight: FontWeight,
    shadow: Shadow,
    iconSize: IconSize,
  };
}

export type AppTheme = ReturnType<typeof getTheme>;
