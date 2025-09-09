import React from 'react';
import { Routes, Route, Link, Navigate } from 'react-router-dom';

import JobsPage from './pages/JobsPage';
import JobDetailsPage from './pages/JobDetailsPage';
import AllJobsPage from './pages/AllJobsPage';
import CalendarPage from './pages/CalendarPage';
import MaterialsPage from './pages/MaterialsPage';
import FinancePage from './pages/FinancePage';
import InvoicePage from './pages/InvoicePage';
import TechniciansPage from './pages/TechniciansPage';
import ChatPage from './pages/ChatPage';
import ChatAdminPage from './pages/ChatAdminPage';

const navStyle = { marginBottom: 20, borderBottom: '1px solid #eee', paddingBottom: 10 };
const linkStyle = { marginRight: 16, textDecoration: 'none', color: '#1976d2', fontWeight: 600 };

export default function App() {
  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>HVAC App ✅</h1>

      <nav style={navStyle}>
        <Link to="/" style={linkStyle}>📋 Заявки</Link>
        <Link to="/calendar" style={linkStyle}>📅 Календарь</Link>
        <Link to="/all" style={linkStyle}>📄 Все заявки</Link>
        <Link to="/materials" style={linkStyle}>📦 Детали</Link>
        <Link to="/chat" style={linkStyle}>💬 Чат</Link>
        <Link to="/admin/chats" style={linkStyle}>⚙️ Чаты (админ)</Link>
        <Link to="/technicians" style={linkStyle}>👥 Сотрудники</Link>
        <Link to="/finance" style={linkStyle}>💰 Финансы</Link>
      </nav>

      <Routes>
        <Route path="/" element={<JobsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/all" element={<AllJobsPage />} />
        <Route path="/materials" element={<MaterialsPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/invoice/:id" element={<InvoicePage />} />
        <Route path="/job/:id" element={<JobDetailsPage />} />
        <Route path="/technicians" element={<TechniciansPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/admin/chats" element={<ChatAdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
