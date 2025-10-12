// client/src/App.js
import React, { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from 'react-router-dom';

import { AuthProvider, useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';

import ProtectedRoute from './components/ProtectedRoute.jsx';
import TopNav from './components/TopNav.jsx';

import EmailTab from './pages/EmailTab.jsx';

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

// 🔹 страница задач
import TasksTodayPage from './pages/TasksTodayPage.jsx';

/* ──────────────────────────────────────────────────────────────────────────────
   Гард на доступ к конкретной заявке для техника:
   admin / manager — всегда; tech — только если заявка назначена на него
   ─────────────────────────────────────────────────────────────────────────── */
function JobAccess({ children }) {
  const { role, profile, user, loading } = useAuth();
  const { id } = useParams();
  const location = useLocation();

  const [checking, setChecking] = useState(true);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (loading) return;
      if (!user) {
        if (alive) { setOk(false); setChecking(false); }
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
        console.error('JobAccess check error:', error?.message || error);
        setOk(false);
        setChecking(false);
        return;
      }

      const jobTechId = data?.technician_id ?? data?.tech_id ?? null;
      const allow = !!profile?.id && jobTechId === profile.id;
      setOk(!!allow);
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

/* ──────────────────────────────────────────────────────────────────────────────
   Оболочка с верхним меню
   ─────────────────────────────────────────────────────────────────────────── */
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

          {/* 🔹 Задачи на сегодня — менеджер + админ */}
          <Route
            path="/tasks/today"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <TasksTodayPage />
              </ProtectedRoute>
            }
          />
          {/* Алиас /tasks → /tasks/today */}
          <Route path="/tasks" element={<Navigate to="/tasks/today" replace />} />

          {/* Заявки (список) — менеджер + админ */}
          <Route
            path="/jobs"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <JobsPage />
              </ProtectedRoute>
            }
          />

          {/* Все заявки (расширенный список) — менеджер + админ */}
          <Route
            path="/jobs/all"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <AllJobsPage />
              </ProtectedRoute>
            }
          />

          {/* Календарь — менеджер + админ */}
          <Route
            path="/calendar"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <CalendarPage />
              </ProtectedRoute>
            }
          />

          {/* Материалы — менеджер + админ */}
          <Route
            path="/materials"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <MaterialsPage />
              </ProtectedRoute>
            }
          />

          {/* Чат (операционный) — менеджер + админ */}
          <Route
            path="/chat"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <ChatPage />
              </ProtectedRoute>
            }
          />

          {/* Email — менеджер + админ */}
          <Route
            path="/email"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <EmailTab />
              </ProtectedRoute>
            }
          />

          {/* Инвойс — менеджер + админ */}
          <Route
            path="/invoice/:id"
            element={
              <ProtectedRoute allow={['admin', 'manager']}>
                <InvoicePage />
              </ProtectedRoute>
            }
          />

          {/* Только админ */}
          <Route
            path="/technicians"
            element={
              <ProtectedRoute allow="admin">
                <TechniciansPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance"
            element={
              <ProtectedRoute allow="admin">
                <FinancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat-admin"
            element={
              <ProtectedRoute allow="admin">
                <ChatAdminPage />
              </ProtectedRoute>
            }
          />

          {/* Детали заявки: admin/manager — всегда; tech — только свою */}
          <Route
            path="/jobs/:id"
            element={
              <ProtectedRoute allow={['admin', 'manager', 'tech']}>
                <JobAccess>
                  <JobDetailsPage />
                </JobAccess>
              </ProtectedRoute>
            }
          />
          {/* Алиас для старых ссылок /job/:id */}
          <Route
            path="/job/:id"
            element={
              <ProtectedRoute allow={['admin', 'manager', 'tech']}>
                <JobAccess>
                  <JobDetailsPage />
                </JobAccess>
              </ProtectedRoute>
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

/* ──────────────────────────────────────────────────────────────────────────────
   Корневой экспорт
   ─────────────────────────────────────────────────────────────────────────── */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  );
}
