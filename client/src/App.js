// client/src/App.js
import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';

import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';

import RequireRole from './components/RequireRole.jsx';
import TopNav from './components/TopNav.jsx';

// страницы
import LoginPage from './pages/LoginPage.jsx';
import NoAccessPage from './pages/NoAccessPage.jsx';

import JobsPage from './pages/JobsPage.jsx';
import AllJobsPage from './pages/AllJobsPage.jsx';
import JobDetailsPage from './pages/JobDetailsPage.jsx';

import CalendarPage from './pages/CalendarPage.jsx';
import MaterialsPage from './pages/MaterialsPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import InvoicePage from './pages/InvoicePage.jsx';

import TechniciansPage from './pages/TechniciansPage.jsx';
import FinancePage from './pages/FinancePage.jsx';
import ChatAdminPage from './pages/ChatAdminPage.jsx';

// ───────────────────────────────────────────────────────────────────────────────
// Гард для доступа к конкретной заявке:
//  - admin/manager: доступ всегда
//  - tech: только если job.technician_id (или tech_id) совпадает с profile.id
// ───────────────────────────────────────────────────────────────────────────────
function JobAccess({ children }) {
  const { role, profile, user, loading } = useAuth();
  const { id } = useParams();
  const location = useLocation();

  const [checking, setChecking] = useState(true);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (loading) return; // дождаться загрузки контекста
      if (!user) {
        if (alive) setOk(false);
        return;
      }
      if (role === 'admin' || role === 'manager') {
        if (alive) { setOk(true); setChecking(false); }
        return;
      }
      // tech: проверяем владельца заявки
      setChecking(true);
      const { data, error } = await supabase
        .from('jobs')
        .select('id, technician_id, tech_id')
        .eq('id', id)
        .maybeSingle();

      if (!alive) return;
      if (error) {
        console.error('JobAccess check error', error);
        setOk(false);
        setChecking(false);
        return;
      }

      const jobTechId = data?.technician_id ?? data?.tech_id ?? null;
      const allow = !!profile?.id && jobTechId === profile.id;
      setOk(allow);
      setChecking(false);
    }

    run();
    return () => { alive = false; };
  }, [id, role, profile?.id, user, loading]);

  if (loading || checking) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!ok) return <Navigate to="/no-access" replace />;
  return children;
}

// ───────────────────────────────────────────────────────────────────────────────
// Layout с верхним меню (скрыт на /login и /no-access)
// ───────────────────────────────────────────────────────────────────────────────
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
          <Route path="/jobs" element={
            <RequireRole allow={['admin','manager']}>
              <JobsPage />
            </RequireRole>
          } />
          <Route path="/jobs/all" element={
            <RequireRole allow={['admin','manager']}>
              <AllJobsPage />
            </RequireRole>
          } />
          <Route path="/calendar" element={
            <RequireRole allow={['admin','manager']}>
              <CalendarPage />
            </RequireRole>
          } />
          <Route path="/materials" element={
            <RequireRole allow={['admin','manager']}>
              <MaterialsPage />
            </RequireRole>
          } />
          <Route path="/chat" element={
            <RequireRole allow={['admin','manager']}>
              <ChatPage />
            </RequireRole>
          } />
          <Route path="/invoice/:id" element={<InvoicePage />}
            <RequireRole allow={['admin','manager']}>
              <InvoicePage />
            </RequireRole>
          } />

          {/* Только Админ */}
          <Route path="/technicians" element={
            <RequireRole allow={['admin']}>
              <TechniciansPage />
            </RequireRole>
          } />
          <Route path="/finance" element={
            <RequireRole allow={['admin']}>
              <FinancePage />
            </RequireRole>
          } />
          <Route path="/chat-admin" element={
            <RequireRole allow={['admin']}>
              <ChatAdminPage />
            </RequireRole>
          } />

          {/* Детали заявки: admin/manager всегда, tech — только свою */}
          <Route path="/jobs/:id" element={
            <RequireRole allow={['admin','manager','tech']}>
              <JobAccess>
                <JobDetailsPage />
              </JobAccess>
            </RequireRole>
          } />
          {/* Алиас для старых ссылок /job/:id */}
          <Route path="/job/:id" element={
            <RequireRole allow={['admin','manager','tech']}>
              <JobAccess>
                <JobDetailsPage />
              </JobAccess>
            </RequireRole>
          } />

          {/* Корень и 404 */}
          <Route index element={<Navigate to="/jobs" replace />} />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
          </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
