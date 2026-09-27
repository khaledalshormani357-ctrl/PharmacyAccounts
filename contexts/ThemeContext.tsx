// Smart Pharmacy ERP — ThemeContext
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getSetting, setSetting } from '@/services/database';
import { getTheme, AppTheme, ThemeMode } from '@/constants/theme';

interface ThemeContextType {
  theme: AppTheme;
  mode: ThemeMode;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    try {
      const saved = getSetting('theme');
      if (saved === 'dark' || saved === 'light') setModeState(saved);
    } catch {}
  }, []);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    try { setSetting('theme', newMode); } catch {}
  };

  return (
    <ThemeContext.Provider value={{ theme: getTheme(mode), mode, toggleTheme: () => setMode(mode === 'light' ? 'dark' : 'light'), setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
