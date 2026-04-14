import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './components/theme-provider';
import { AuthProvider } from './lib/auth';
import { AppProvider } from './lib/store';
import AppLayout from './components/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';
import CookieConsent from './components/CookieConsent';
import Analytics from './components/Analytics';
import { Toaster } from './components/ui/toaster';
import { Toaster as Sonner } from './components/ui/sonner';

const queryClient = new QueryClient();

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppProvider>
              <AppLayout />
              <CookieConsent />
              <Analytics />
              <Toaster />
              <Sonner />
            </AppProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
