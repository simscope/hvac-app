// client/src/App.js
import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';

// Гарды
import RequireRole from './components/RequireRole.jsx';

// Верхнее меню
import TopNav from './components/TopNav.jsx';

// Страницы
import LoginPage from './pages/LoginPage.jsx';
import NoAccessPage from './pages/NoAccessPage.jsx';

import JobsPage from './pages/JobsPage.jsx';
import AllJobsPage from './pages/AllJobsPage.jsx';
import JobDetailsPage from './pages/JobDetailsPage.jsx';

import CalendarPage from './pages/CalendarPage.jsx';
import MaterialsPage from './pages/MaterialsPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import InvoicePage from './pages/InvoicePage.jsx';

// Админские
import TechniciansPage from './pages/TechniciansPage.jsx';
import FinancePage from './pages/FinancePage.jsx';
import ChatAdminPage from './pages/ChatAdminPage.jsx';

// (если файл есть)
import ErrorBoundary from './ErrorBoundary.jsx';

function Shell() {
  const { pathname } = useLocation();
  const hideNav = pathname === '/login' || pathname === '/no-access';

  return (
    <div className="app-shell">
      {!hideNav && <TopNav />}
      <div className="app-page">
        <Routes>
          {/* Публичные */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/no-access" element={<NoAccessPage />} />

          {/* Менеджер + Админ */}
          <Route
            path="/jobs"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <JobsPage />
              </RequireRole>
            }
          />
          <Route
            path="/jobs/all"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <AllJobsPage />
              </RequireRole>
            }
          />
          <Route
            path="/jobs/:id"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <JobDetailsPage />
              </RequireRole>
            }
          />
          <Route
            path="/calendar"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <CalendarPage />
              </RequireRole>
            }
          />
          <Route
            path="/materials"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <MaterialsPage />
              </RequireRole>
            }
          />
          <Route
            path="/chat"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <ChatPage />
              </RequireRole>
            }
          />
          <Route
            path="/invoice/:jobId"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <InvoicePage />
              </RequireRole>
            }
          />

          {/* Только Админ */}
          <Route
            path="/technicians"
            element={
              <RequireRole allow={['admin']}>
                <TechniciansPage />
              </RequireRole>
            }
          />
          <Route
            path="/finance"
            element={
              <RequireRole allow={['admin']}>
                <FinancePage />
              </RequireRole>
            }
          />
          <Route
            path="/chat-admin"
            element={
              <RequireRole allow={['admin']}>
                <ChatAdminPage />
              </RequireRole>
            }
          />

          {/* Корень и 404 */}
          <Route index element={<Navigate to="/jobs" replace />} />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  const tree = <Shell />;
  return (
    <AuthProvider>
      {typeof ErrorBoundary === 'function' ? (
        <ErrorBoundary>{tree}</ErrorBoundary>
      ) : (
        tree
      )}
    </AuthProvider>
  );
}
