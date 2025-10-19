// client/src/pages/TechniciansMap.jsx
// Карта техников: первичная загрузка из VIEW public.tech_locations_latest,
// затем realtime подписка на INSERT/UPDATE в public.tech_locations (сырьё).
// Параллельно подгружаем technicians (имя/статус), мержим по technician_id.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';

// Иконки Leaflet по умолчанию починить (в бандлере иногда пустые)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const badgeStyle = (state) => {
  const c = String(state || '').toLowerCase();
  if (c === 'on_site' || c === 'working') return { bg: '#dcfce7', fg: '#166534', text: c };
  if (c === 'en_route') return { bg: '#e0f2fe', fg: '#075985', text: c };
  if (c === 'idle') return { bg: '#fef9c3', fg: '#854d0e', text: c };
  return { bg: '#e5e7eb', fg: '#374151', text: c || 'unknown' };
};

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2), { animate: false });
    }
  }, [points, map]);
  return null;
}

export default function TechniciansMap() {
  const [loading, setLoading] = useState(true);
  const [latest, setLatest] = useState([]);       // [{technician_id, lat, lng, captured_at, ...}]
  const [techMeta, setTechMeta] = useState({});   // { [technician_id]: { name, phone, live_state } }
  const channelRef = useRef(null);

  // 1) первичная загрузка: последняя точка + тех.мета
  useEffect(() => {
    let mounted = true;

    async function loadInitial() {
      setLoading(true);
      try {
        // Последние точки из VIEW
        const { data: points, error: e1 } = await supabase
          .from('tech_locations_latest')
          .select('technician_id, lat, lng, accuracy, speed, heading, captured_at');
        if (e1) throw e1;

        // Мета по техникам (имя/статус) — адаптируй поля под себя
        const { data: techs, error: e2 } = await supabase
          .from('technicians')
          .select('id, full_name, phone, live_state');
        if (e2) throw e2;

        if (!mounted) return;

        const meta = {};
        (techs || []).forEach(t => {
          meta[t.id] = {
            name: t.full_name || `Tech ${t.id.slice(0, 4)}`,
            phone: t.phone || '',
            live_state: t.live_state || 'idle',
          };
        });

        setTechMeta(meta);
        setLatest(points || []);
      } catch (e) {
        console.error(e);
        setLatest([]);
      } finally {
        setLoading(false);
      }
    }

    loadInitial();

    return () => { mounted = false; };
  }, []);

  // 2) realtime по сырой таблице tech_locations — обновляем "последние"
  useEffect(() => {
    const ch = supabase
      .channel('tech-locations-rt')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tech_locations' },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row?.technician_id || typeof row.lat !== 'number' || typeof row.lng !== 'number') return;

          setLatest(prev => {
            // upsert по technician_id
            const idx = prev.findIndex(p => p.technician_id === row.technician_id);
            const nextPoint = {
              technician_id: row.technician_id,
              lat: row.lat, lng: row.lng,
              captured_at: row.captured_at || new Date().toISOString(),
              accuracy: row.accuracy ?? null,
              speed: row.speed ?? null,
              heading: row.heading ?? null,
            };
            if (idx === -1) return [...prev, nextPoint];
            const copy = [...prev];
            copy[idx] = nextPoint;
            return copy;
          });
        }
      )
      .subscribe();

    channelRef.current = ch;
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, []);

  const points = useMemo(() => latest.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number'), [latest]);
  const center = points.length ? [points[0].lat, points[0].lng] : [37.0902, -95.7129]; // USA центр на старте, замени при желании

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', height: '100vh' }}>
      {/* MAP */}
      <div style={{ position: 'relative' }}>
        <MapContainer center={center} zoom={4} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={points} />

          {points.map(p => {
            const meta = techMeta[p.technician_id] || {};
            const badge = badgeStyle(meta.live_state);
            return (
              <Marker key={p.technician_id} position={[p.lat, p.lng]}>
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <strong>{meta.name || p.technician_id}</strong>
                      <span style={{ padding: '2px 6px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: badge.bg, color: badge.fg }}>
                        {badge.text}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: '#374151' }}>
                      <div>Lat/Lng: {p.lat.toFixed(5)}, {p.lng.toFixed(5)}</div>
                      {p.captured_at ? <div>At: {new Date(p.captured_at).toLocaleString()}</div> : null}
                      {typeof p.speed === 'number' ? <div>Speed: {Math.round((p.speed || 0) * 3.6)} km/h</div> : null}
                      {meta.phone ? <div>Phone: {meta.phone}</div> : null}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {loading && (
          <div style={{
            position: 'absolute', top: 12, left: 12, background: 'rgba(255,255,255,.9)',
            padding: '8px 10px', borderRadius: 8, fontWeight: 700
          }}>
            Loading…
          </div>
        )}
      </div>

      {/* SIDEBAR */}
      <aside style={{ borderLeft: '1px solid #e5e7eb', padding: 12, overflow: 'auto' }}>
        <h3 style={{ margin: '8px 0 12px', fontSize: 18 }}>Technicians</h3>
        {points
          .sort((a, b) => (techMeta[a.technician_id]?.name || '').localeCompare(techMeta[b.technician_id]?.name || ''))
          .map(p => {
            const meta = techMeta[p.technician_id] || {};
            const badge = badgeStyle(meta.live_state);
            return (
              <div key={p.technician_id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 800 }}>{meta.name || p.technician_id}</div>
                  <span style={{ padding: '2px 6px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: badge.bg, color: badge.fg }}>
                    {badge.text}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
                  <div>Lat/Lng: {p.lat.toFixed(5)}, {p.lng.toFixed(5)}</div>
                  {p.captured_at ? <div>At: {new Date(p.captured_at).toLocaleTimeString()}</div> : null}
                  {typeof p.speed === 'number' ? <div>Speed: {Math.round((p.speed || 0) * 3.6)} km/h</div> : null}
                  {meta.phone ? <div>Phone: {meta.phone}</div> : null}
                </div>
              </div>
            );
          })}
        {!points.length && !loading && <div style={{ color: '#6b7280' }}>Нет активных точек.</div>}
      </aside>
    </div>
  );
}
