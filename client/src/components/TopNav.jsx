// client/src/components/TopNav.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';

const norm = (r) => {
  if (!r) return null;
  const x = String(r).toLowerCase();
  return x === 'technician' ? 'tech' : x;
};

// Встроенные SVG-иконки
const Icon = {
  Jobs: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M9 3h6a2 2 0 0 1 2 2v1h2.5A1.5 1.5 0 0 1 21 7.5v10A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10A1.5 1.5 0 0 1 4.5 6H7V5a2 2 0 0 1 2-2Zm0 3h6V5H9v1Z"/>
    </svg>
  ),
  All: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"/>
    </svg>
  ),
  Calendar: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h2V2Zm-3 8v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9H4Z"/>
    </svg>
  ),
  Materials: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M12 2 3 6.5V18l9 4 9-4V6.5L12 2Zm0 2.2 6.8 3.2L12 10.6 5.2 7.4 12 4.2ZM5 9.6l7 3.3v6.9l-7-3.1V9.6Zm9 10.2v-6.9l7-3.3v7.1l-7 3.1Z"/>
    </svg>
  ),
  Chat: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v15l4-3h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM6 9h8v2H6V9Zm0-4h12v2H6V5Z"/>
    </svg>
  ),
  Tasks: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M9 2h6a2 2 0 0 1 2 2v1h3v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5h3V4a2 2 0 0 1 2-2Zm0 3h6V4H9v1Zm-1 5h8v2H8V10Zm0 4h8v2H8v-2Z"/>
    </svg>
  ),
  Techs: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.33 0-8 2-8 4.5V21h16v-2.5C20 16 16.33 14 12 14Z"/>
    </svg>
  ),
  Money: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M3 6h18a2 2 0 0 1 2 2v8H1V8a2 2 0 0 1 2-2Zm0 12h18v2H3v-2Zm9-8a3 3 0 1 0 3 3 3 3 0 0 0-3-3Z"/>
    </svg>
  ),
  AdminChat: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M2 4a2 2 0 0 1 2-2h10l4 4v6a2 2 0 0 1-2 2H9l-5 4V4Zm18 6h2v8l-5-3h-7v-2h8a2 2 0 0 0 2-2V10Z"/>
    </svg>
  ),
  Email: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M3 5h18a2 2 0 0
