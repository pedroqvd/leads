import React, { useState, useEffect } from 'react';
import {
  TrendingUp, Users, CheckCircle, BarChart2,
  RefreshCw, AlertCircle,
} from 'lucide-react';
import Layout from '../components/Layout.jsx';
import api    from '../services/api.js';

// Paleta de cores para origens
const SOURCE_COLORS_HEX = [
  '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

function StatCard({ icon: Icon, label, value, sub, colorClass }) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/** Gráfico de barras horizontais em CSS puro */
function HBarChart({ data, colorFn, valueKey = 'count', labelKey = 'source', maxItems = 8 }) {
  if (!data?.length) return <p className="text-gray-400 text-sm text-center py-8">Sem dados</p>;

  const sliced = data.slice(0, maxItems);
  const max    = Math.max(...sliced.map(d => d[valueKey]));

  return (
    <div className="space-y-3">
      {sliced.map((d, i) => {
        const pct = max > 0 ? (d[valueKey] / max) * 100 : 0;
        return (
          <div key={i} className="flex items-center gap-3">
            <span
              className="text-xs text-gray-600 font-medium truncate"
              style={{ width: '9rem', flexShrink: 0 }}
              title={d[labelKey]}
            >
              {d[labelKey]}
            </span>
            <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
              <div
                className="h-full rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: colorFn(i) }}
              >
                {pct > 20 && (
                  <span className="text-white text-xs font-semibold">{d[valueKey]}</span>
                )}
              </div>
            </div>
            {pct <= 20 && (
              <span className="text-xs text-gray-500 font-medium w-6 text-right">{d[valueKey]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Gráfico de linha (timeline) com SVG */
function LineChart({ data }) {
  if (!data?.length) return <p className="text-gray-400 text-sm text-center py-8">Sem dados</p>;

  const W = 600;
  const H = 140;
  const PAD = { top: 12, right: 16, bottom: 28, left: 32 };

  const counts = data.map(d => d.count);
  const maxVal = Math.max(...counts, 1);

  function toX(i) {
    return PAD.left + (i / Math.max(data.length - 1, 1)) * (W - PAD.left - PAD.right);
  }
  function toY(v) {
    return PAD.top + (1 - v / maxVal) * (H - PAD.top - PAD.bottom);
  }

  const points = data.map((d, i) => `${toX(i)},${toY(d.count)}`).join(' ');
  const area   = `M ${toX(0)},${toY(0)} ` +
                 data.map((d, i) => `L ${toX(i)},${toY(d.count)}`).join(' ') +
                 ` L ${toX(data.length - 1)},${H - PAD.bottom} L ${toX(0)},${H - PAD.bottom} Z`;

  // Mostra apenas ~6 labels no eixo X
  const step    = Math.ceil(data.length / 6);
  const xLabels = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '160px' }}>
      {/* Área preenchida */}
      <path d={area} fill="#3b82f620" />

      {/* Linha */}
      <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />

      {/* Pontos */}
      {data.map((d, i) => (
        d.count > 0 && (
          <circle key={i} cx={toX(i)} cy={toY(d.count)} r="3" fill="#3b82f6" />
        )
      ))}

      {/* Eixo X labels */}
      {xLabels.map((d, i) => {
        const idx = data.indexOf(d);
        const label = d.date.slice(5); // MM-DD
        return (
          <text
            key={i}
            x={toX(idx)}
            y={H - 4}
            textAnchor="middle"
            fontSize="10"
            fill="#9ca3af"
          >
            {label}
          </text>
        );
      })}

      {/* Eixo Y — valor máximo */}
      <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fontSize="10" fill="#9ca3af">
        {maxVal}
      </text>
    </svg>
  );
}

// ─── Página Analytics ─────────────────────────────────────────────────────────
export default function Analytics() {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState('');
  const [days, setDays]     = useState(30);

  async function fetchData() {
    setLoad(true);
    setError('');
    try {
      const res = await api.get('/analytics', { params: { days } });
      setData(res.data);
    } catch {
      setError('Não foi possível carregar os dados de analytics.');
    } finally {
      setLoad(false);
    }
  }

  useEffect(() => { fetchData(); }, [days]);

  const summary = data?.summary ?? {};

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
            <p className="text-gray-500 mt-1 text-sm">Métricas de aquisição e conversão de leads.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
            <button
              onClick={fetchData}
              disabled={loading}
              className="btn-secondary py-2 px-3 text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="py-24 text-center">
            <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Carregando métricas…</p>
          </div>
        ) : (
          <>
            {/* Cards de resumo */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard
                icon={Users}
                label="Total Geral"
                value={summary.totalLeads ?? 0}
                sub="todos os leads"
                colorClass="bg-brand-50 text-brand-600"
              />
              <StatCard
                icon={TrendingUp}
                label={`Últimos ${days}d`}
                value={summary.recentLeads ?? 0}
                sub="no período selecionado"
                colorClass="bg-blue-50 text-blue-600"
              />
              <StatCard
                icon={CheckCircle}
                label="Convertidos"
                value={summary.converted ?? 0}
                sub="no total"
                colorClass="bg-green-50 text-green-600"
              />
              <StatCard
                icon={BarChart2}
                label="Taxa de Conversão"
                value={`${summary.conversionRate ?? 0}%`}
                sub="leads → convertidos"
                colorClass="bg-violet-50 text-violet-600"
              />
            </div>

            {/* Gráficos — linha 1 */}
            <div className="grid lg:grid-cols-2 gap-6 mb-6">

              {/* Leads por origem */}
              <div className="card">
                <h2 className="font-semibold text-gray-800 mb-1">Leads por Origem</h2>
                <p className="text-xs text-gray-400 mb-5">De onde vêm seus leads</p>
                <HBarChart
                  data={data?.sourceCounts ?? []}
                  colorFn={i => SOURCE_COLORS_HEX[i % SOURCE_COLORS_HEX.length]}
                  valueKey="count"
                  labelKey="source"
                />
              </div>

              {/* Leads por campanha */}
              <div className="card">
                <h2 className="font-semibold text-gray-800 mb-1">Top Campanhas</h2>
                <p className="text-xs text-gray-400 mb-5">Melhores campanhas por volume de leads</p>
                {data?.campaignCounts?.length ? (
                  <HBarChart
                    data={data.campaignCounts}
                    colorFn={i => SOURCE_COLORS_HEX[(i + 2) % SOURCE_COLORS_HEX.length]}
                    valueKey="count"
                    labelKey="campaign"
                  />
                ) : (
                  <p className="text-gray-400 text-sm text-center py-8">
                    Sem dados de UTM Campaign ainda.
                  </p>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="card mb-6">
              <h2 className="font-semibold text-gray-800 mb-1">Leads por Dia</h2>
              <p className="text-xs text-gray-400 mb-4">Volume diário nos últimos {days} dias</p>
              <LineChart data={data?.timeline ?? []} />
            </div>

            {/* Funil de status */}
            <div className="card">
              <h2 className="font-semibold text-gray-800 mb-1">Distribuição por Status</h2>
              <p className="text-xs text-gray-400 mb-5">Total geral de leads por etapa do funil</p>
              <div className="grid sm:grid-cols-4 gap-4">
                {[
                  { label: 'Novo',       color: '#3b82f6', bg: 'bg-blue-50',   text: 'text-blue-700' },
                  { label: 'Em Contato', color: '#f59e0b', bg: 'bg-amber-50',  text: 'text-amber-700' },
                  { label: 'Convertido', color: '#10b981', bg: 'bg-green-50',  text: 'text-green-700' },
                  { label: 'Perdido',    color: '#ef4444', bg: 'bg-red-50',    text: 'text-red-700' },
                ].map(({ label, bg, text }) => (
                  <div key={label} className={`rounded-xl p-4 ${bg} text-center`}>
                    <p className={`text-3xl font-extrabold ${text}`}>
                      {data?.statusCounts?.[label] ?? 0}
                    </p>
                    <p className={`text-sm font-medium mt-1 ${text}`}>{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
