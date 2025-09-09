// добавь эти импорты
import { Link, Routes, Route } from 'react-router-dom';
import { useAuth, RequireAdmin, RequireAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';

// … твои страницы: JobsPage, CalendarPage, TechniciansPage и т.д.

export default function App() {
  const { profile, isAdmin, user } = useAuth();

  const link = { marginRight: 16 };

  return (
    <div className="p-4">
      <nav style={{ marginBottom: 12, borderBottom: '1px solid #eee', paddingBottom: 8 }}>
        <Link to="/" style={link}>📋 Заявки</Link>
        <Link to="/calendar" style={link}>📅 Календарь</Link>
        <Link to="/JoAllJobsPage" style={link}>📄 Все заявки</Link>
        <Link to="/materials" style={link}>📦 Детали</Link>
        <Link to="/chat" style={link}>💬 Чат</Link>

        {/* Админка — видит только admin */}
        {isAdmin && (
          <>
            <Link to="/admin/chats" style={link}>⚙️ Чаты (админ)</Link>
            <Link to="/technicians" style={link}>👥 Сотрудники</Link>
            <Link to="/finance" style={link}>💰 Финансы</Link>
          </>
        )}

        {/* Справа — вход/выход */}
        <span style={{ float: 'right' }}>
          {user ? <span>{user.email}</span> : <Link to="/login">Войти</Link>}
        </span>
      </nav>

      <Routes>
        {/* Открытые или защищённые пути — как у тебя было */}
        <Route path="/" element={<RequireAuth><JobsPage/></RequireAuth>} />
        <Route path="/calendar" element={<RequireAuth><CalendarPage/></RequireAuth>} />
        <Route path="/JoAllJobsPage" element={<RequireAuth><AllJobsPage/></RequireAuth>} />
        <Route path="/materials" element={<RequireAuth><MaterialsPage/></RequireAuth>} />
        <Route path="/chat" element={<RequireAuth><ChatPage/></RequireAuth>} />

        {/* Админские */}
        <Route path="/admin/chats" element={<RequireAdmin><ChatAdminPage/></RequireAdmin>} />
        <Route path="/technicians" element={<RequireAdmin><TechniciansPage/></RequireAdmin>} />
        <Route path="/finance" element={<RequireAdmin><FinancePage/></RequireAdmin>} />

        {/* Логин */}
        <Route path="/login" element={<LoginPage/>} />
      </Routes>
    </div>
  );
}
