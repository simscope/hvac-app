import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

export default function AssignedWorkPage() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      if (!profile?.id) { if (active) { setJobs([]); setLoading(false); } return; }
      const response = await supabase.from('jobs')
        .select('id,job_number,issue,status,appointment_time')
        .eq('technician_id', profile.id)
        .order('appointment_time', { ascending: true, nullsFirst: false });
      if (!active) return;
      setError(response.error ? 'Could not load your assigned work. Please retry.' : '');
      setJobs(response.error ? [] : response.data || []);
      setLoading(false);
    })().catch(() => { if (active) { setError('Could not load your assigned work.'); setLoading(false); } });
    return () => { active = false; };
  }, [profile?.id]);
  return <main style={{ padding: 16 }}>
    <h1>{pathname === '/calendar' ? 'My calendar' : 'My assigned jobs'}</h1>
    <p>Only your assigned jobs. Completed and recalled jobs require staff changes.</p>
    {loading && <p role="status">Loading…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && jobs.length === 0 && <p>No assigned jobs.</p>}
    <ol style={{ padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
      {jobs.map(job => <li key={job.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <time>{job.appointment_time ? new Date(job.appointment_time).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' NY' : 'Not scheduled'}</time>
        <div><Link to={'/jobs/' + job.id}>Job {job.job_number || 'details'} — {job.issue || 'Assigned work'}</Link></div>
        <div>{job.status}</div>
      </li>)}
    </ol>
  </main>;
}
