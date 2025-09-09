   // src/App.jsx
import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute'; // если ты его оставляешь
import RequireRole from './components/RequireRole';
import TopNav from './components/TopNav';

// страницы
import LoginPage from './pages/LoginPage';
import NoAccessPage from './pages/NoAccessPage';

import JobsPage from './pages/JobsPage';
import JobDetailsPage from './pages/JobDetailsPage';
import TechnicianCalendar from './pages/TechnicianCalendar';
import InvoicePage from './pages/InvoicePage';
import MaterialsPage from './pages/MaterialsPage';
import ChatPage from './pages/ChatPage';

import StaffPage from './pages/StaffPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

// Layout с верхним меню (кроме /login)
function Shell({ children }) {
  return (
    <div>
      <TopNav />
      <div>{children}</div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* публично */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/no-access" element={<NoAccessPage />} />

          {/* менеджер + админ */}
          <Route
            path="/jobs"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <Shell><JobsPage /></Shell>
              </RequireRole>
            }
          />
          <Route
            path="/jobs/all"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <Shell><JobsPage mode="all" /></Shell>
              </RequireRole>
            }
          />
          <Route
            path="/jobs/:id"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <Shell><JobDetailsPage /></Shell>
              </RequireRole>
            }
          />
          <Route
            path="/calendar"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <Shell><TechnicianCalendar /></Shell>
              </RequireRole>
            }
          />
          <Route
            path="/materials"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <Shell><MaterialsPage /></Shell>
              </RequireRole>
            }
          />
          <Route
            path="/chat"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <Shell><ChatPage /></Shell>
              </RequireRole>
            }
          />
          <Route
            path="/invoice/:jobId"
            element={
              <RequireRole allow={['admin', 'manager']}>
                <Shell><InvoicePage /></Shell>
              </RequireRole>
            }
          />

          {/* только админ */}
          <Route
            path="/staff"
            element={
              <RequireRole allow={['admin']}>
                <Shell><StaffPage /></Shell>
              </RequireRole>
            }
          />
          <Route
            path="/reports"
            element={
              <RequireRole allow={['admin']}>
                <Shell><ReportsPage /></Shell>
              </RequireRole>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireRole allow={['admin']}>
                <Shell><SettingsPage /></Shell>
              </RequireRole>
            }
          />

          {/* корень → в заявки (если есть доступ), иначе на /no-access */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Shell><JobsPage /></Shell>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
