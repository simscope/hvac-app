import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';

import JobDetailsPage from './pages/JobDetailsPage';
import JobsPage from './pages/JobsPage';
import AllJobsPage from './pages/AllJobsPage';
import CalendarPage from './pages/CalendarPage';
import MaterialsPage from './pages/MaterialsPage';
import FinancePage from './pages/FinancePage';
import InvoicePage from './pages/InvoicePage';
import TechniciansPage from './pages/TechniciansPage';
import ChatPage from './pages/ChatPage';
import ChatAdminPage from './pages/ChatAdminPage';

const navStyle = { marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' };
const linkStyle = { marginRight: '20px', textDecoration: 'none', color: '#1976d2', fontWeight: 'bold', fontSize: '16px' };

export default function App() {
  return (
    <div style={{ padding: '20px' }}>
      <nav style={navStyle}>
        <Link to="/" style={linkStyle}>📋 Заявки</Link>
        <Link to="/calendar" style={linkStyle}>📅 Календарь</Link>
        <Link to="/JoAllJobsPage" style={linkStyle}>📄 Все заявки</Link>
        <Link to="/materials" style={linkStyle}>📦 Детали</Link>
        <Link to="/chat" style={linkStyle}>💬 Чат</Link>
        <Link to="/admin/chats" style={linkStyle}>⚙️ Чаты (админ)</Link>
        <Link to="/technicians" style={linkStyle}>👥 Сотрудники</Link>
        <Link to="/finance" style={linkStyle}>💰 Финансы</Link>
      </nav>

      <Routes>
        <Route path="/" element={<JobsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/JoAllJobsPage" element={<AllJobsPage />} />
        <Route path="/materials" element={<MaterialsPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/invoice/:id" element={<InvoicePage />} />
        <Route path="/job/:id" element={<JobDetailsPage />} />
        <Route path="/technicians" element={<TechniciansPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/admin/chats" element={<ChatAdminPage />} />
      </Routes>
    </div>
  );
}
