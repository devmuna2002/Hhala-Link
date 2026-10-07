import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'hlala_theme_mode';

export const lightPalette = {
  bg: '#FFFFFF',
  card: '#FFFFFF',
  text: '#000000',
  title: '#111827',
  sub: '#8A8A8A',
  sub2: '#6B7280',
  hairline: '#EFEFEF',
  hairline2: '#F0F0F0',
  input: '#F0F0F0',
  chip: '#EEF3FC',
  tile: '#F0F0F0',
  statusBar: 'dark-content',
};

export const darkPalette = {
  bg: '#000000',
  card: '#101014',
  text: '#FFFFFF',
  title: '#FFFFFF',
  sub: '#A1A1A6',
  sub2: '#8E8E93',
  hairline: '#26262B',
  hairline2: '#1C1C1E',
  input: '#1C1C1E',
  chip: '#1C1C1E',
  tile: '#1C1C1E',
  statusBar: 'light-content',
};

const ThemeContext = createContext({ dark: false, t: lightPalette, setDark: () => {} });

export function ThemeProvider({ children }) {
  const [dark, setDarkState] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((v) => { if (v === 'dark') setDarkState(true); })
      .catch(() => {});
  }, []);
  const setDark = (v) => {
    setDarkState(!!v);
    AsyncStorage.setItem(THEME_KEY, v ? 'dark' : 'light').catch(() => {});
  };
  const t = dark ? darkPalette : lightPalette;
  return <ThemeContext.Provider value={{ dark, t, setDark }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
