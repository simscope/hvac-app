import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import InvoicePage from './pages/InvoicePage';

export default function App() {
  return (
    <div style={{ padding: 16 }}>
      <h1>HVAC App ✅</h1>
      <nav style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Link to="/">Home</Link>
        <Link to="/invoice/1">Invoice #1</Link>
      </nav>
      <Routes>
        <Route path="/" element={<div>It works 🎉</div>} />
        <Route path="/invoice/:id" element={<InvoicePage />} />
      </Routes>
    </div>
  );
}
