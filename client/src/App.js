import React from 'react';
import { Routes, Route, Link, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { RequireAuth, RequireRole } from './context/AuthContext';

// страницы
import JobsPage from './pages/JobsPage';
import CalendarPage from './pages/CalendarPage';
import AllJobsPage from './pages/AllJobsPage';
import MaterialsPage from './pages/MaterialsPage';
import ChatPage from './pages/ChatPage';
import ChatAdminPage from './pages/ChatAdminPage';
import TechniciansPage from './pages/TechniciansPage';
import FinancePage from './pages/FinancePage';
import LoginPage from './pages/LoginPage';

const navStyle = { marginBottom: 20, borderBottom: '1px solid #ccc', paddingBottom: 10 };
const linkStyle = { marginRight: 16 };

export default function App() {
  const { role, signOut, user } = useAuth();

  return (
    <div style={{ padding: 20 }}>
      {/* Навигация показываем только когда есть user */}
      {user && (
        <nav style={navStyle}>
          {/* общие для manager+admin */}
          <Link to="/" style={linkStyle}>📋 Заявки</Link>
          {['manager','admin'].includes(role) && (
            <>
              <Link to="/calendar" style={linkStyle}>📅 Календарь</Link>
              <Link to="/all" style={linkStyle}>📄 Все заявки</Link>
              <Link to="/materials" style={linkStyle}>📦 Детали</Link>
              <Link to="/chat" style={linkStyle}>💬 Чат</Link>
            </>
          )}
          {/* только админ */}
          {role === 'admin' && (
            <>
              <Link to="/admin/chats" style={linkStyle}>🛠 Чат админка</Link>
              <Link to="/technicians" style={linkStyle}>👥 Сотрудники</Link>
              <Link to="/finance" style={linkStyle}>💰 Финансы</Link>
            </>
          )}
          <button onClick={signOut} style={{ marginLeft: 10 }}>Выйти</button>
        </nav>
      )}

      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={
          <RequireAuth>
            <JobsPage />
          </RequireAuth>
        } />
        <Route path="/calendar" element={
          <RequireAuth><RequireRole anyOf={['manager','admin']}><CalendarPage/></RequireRole></RequireAuth>
        } />
        <Route path="/all" element={
          <RequireAuth><RequireRole anyOf={['manager','admin']}><AllJobsPage/></RequireRole></RequireAuth>
        } />
        <Route path="/materials" element={
          <RequireAuth><RequireRole anyOf={['manager','admin']}><MaterialsPage/></RequireRole></RequireAuth>
        } />
        <Route path="/chat" element={
          <RequireAuth><RequireRole anyOf={['manager','admin']}><ChatPage/></RequireRole></RequireAuth>
        } />
        {/* admin-only */}
        <Route path="/admin/chats" element={
          <RequireAuth><RequireRole anyOf={['admin']}><ChatAdminPage/></RequireRole></RequireAuth>
        } />
        <Route path="/technicians" element={
          <RequireAuth><RequireRole anyOf={['admin']}><TechniciansPage/></RequireRole></RequireAuth>
        } />
        <Route path="/finance" element={
          <RequireAuth><RequireRole anyOf={['admin']}><FinancePage/></RequireRole></RequireAuth>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
