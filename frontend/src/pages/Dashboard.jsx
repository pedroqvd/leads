import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, CheckCircle, XCircle, PhoneCall,
  Download, Search, RefreshCw, Trash2,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown,
  Phone, Mail, Calendar, Filter, AlertCircle, ExternalLink,
  Building2, X, Loader2,
} from 'lucide-react';
import Layout from '../components/Layout.jsx';
import api    from '../services/api.js';

// ─── Configuração de status ───────────────────────────────────────────────────
const STATUS_CFG = {
  'Novo':        { badge: 'bg-blue-50 text-blue-700 border-blue-200',   dot: 'bg-blue-500' },
  'Em Contato':  { badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  'Convertido':  { badge: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500' },
  'Perdido':     { badge: 'bg-red-50 text-red-700 border-red-200',       dot: 'bg-red-500' },
};
const STATUSES = Object.keys(STATUS_CFG);

const SOURCE_COLORS = {
  'Meta Ads':        'bg-blue-50 text-blue-700 border-blue-200',
  'Google Ads':      'bg-yellow-50 text-yellow-700 border-yellow-200',
  'LinkedIn Ads':    'bg-sky-50 text-sky-700 border-sky-200',
  'TikTok Ads':      'bg-pink-50 text-pink-700 border-pink-200',
  'X Ads':           'bg-slate-50 text-slate-700 border-slate-200',
  'E-mail':          'bg-violet-50 text-violet-700 border-violet-200',
  'Orgânico':        'bg-green-50 text-green-700 border-green-200',
  'Google Orgânico': 'bg-green-50 text-green-700 border-green-200',
  'Indicação':       'bg-orange-50 text-orange-700 border-orange-200',
  'Direct':          'bg-gray-100 text-gray-600 border-gray-200',
};

function sourceClass(source) {
  return SOURCE_COLORS[source] ?? 'bg-gray-100 text-gray-600 border-gray-200';
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────
function SourceBadge({ source }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${sourceClass(source)}`}>
      {source || 'Direct'}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, colorClass, subLabel }) {
  return (
    <div className="card flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-gray-500 font-medium truncate">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        {subLabel && <p className="text-xs text-gray-400 mt-0.5">{subLabel}</p>}
      </div>
    </div>
  );
}

function SortIcon({ field, sortBy, sortOrder }) {
  if (sortBy !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />;
  return sortOrder === 'asc'
    ? <ChevronUp   className="w-3.5 h-3.5 text-brand-600 flex-shrink-0" />
    : <ChevronDown className="w-3.5 h-3.5 text-brand-600 flex-shrink-0" />;
}

function Avatar({ nome }) {
  return (
    <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center flex-shrink-0 text-brand-700 text-xs font-bold select-none">
      {nome.charAt(0).toUpperCase()}
    </div>
  );
}

function EmptyState({ search, status, source }) {
  return (
    <div className="py-20 text-center">
      <Users className="w-12 h-12 text-gray-200 mx-auto mb-4" />
      <h3 className="text-base font-semibold text-gray-700 mb-1">Nenhum lead encontrado</h3>
      <p className="text-gray-400 text-sm max-w-xs mx-auto">
        {search || status || source
          ? 'Tente ajustar os filtros de busca.'
          : 'Compartilhe a landing page para começar a capturar leads.'}
      </p>
      {!search && !status && !source && (
        <Link
          to="/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 mt-4 font-medium transition-colors"
        >
          Ver landing page <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  );
}

// ─── Modal de CNPJ ───────────────────────────────────────────────────────────
function CnpjModal({ lead, onClose, onSaved }) {
  const [cnpjInput, setCnpjInput] = useState(lead.cnpj || '');
  const [empresa, setEmpresa]     = useState(null);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  function formatCnpjDisplay(val) {
    const d = val.replace(/\D/g, '').slice(0, 14);
    return d
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  async function handleConsultar() {
    const digits = cnpjInput.replace(/\D/g, '');
    if (digits.length !== 14) {
      setError('Informe um CNPJ com 14 dígitos.');
      return;
    }
    setLoading(true);
    setError('');
    setEmpresa(null);
    try {
      const { data } = await api.get(`/cnpj/${digits}`);
      setEmpresa(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao consultar CNPJ.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSalvar() {
    const digits = cnpjInput.replace(/\D/g, '');
    setSaving(true);
    try {
      await api.patch(`/leads/${lead.id}`, { cnpj: digits || null });
      onSaved(lead.id, digits || null);
      onClose();
    } catch {
      setError('Erro ao salvar CNPJ. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-brand-600" />
            <h2 className="font-semibold text-gray-900">Consultar CNPJ</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-500">
            Lead: <span className="font-medium text-gray-800">{lead.nome}</span>
          </p>

          {/* Input CNPJ */}
          <div className="flex gap-2">
            <input
              type="text"
              value={formatCnpjDisplay(cnpjInput)}
              onChange={e => setCnpjInput(e.target.value)}
              placeholder="00.000.000/0001-00"
              className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono"
              onKeyDown={e => e.key === 'Enter' && handleConsultar()}
            />
            <button
              onClick={handleConsultar}
              disabled={loading}
              className="btn-primary px-4 py-2.5 text-sm flex-shrink-0"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Consultar'}
            </button>
          </div>

          {/* Erro */}
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Resultado da consulta */}
          {empresa && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2.5 border border-gray-100">
              <div>
                <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Razão Social</p>
                <p className="text-sm font-semibold text-gray-900">{empresa.razaoSocial}</p>
              </div>
              {empresa.nomeFantasia && (
                <div>
                  <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Nome Fantasia</p>
                  <p className="text-sm text-gray-700">{empresa.nomeFantasia}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                {empresa.municipio && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Município</p>
                    <p className="text-sm text-gray-700">{empresa.municipio} / {empresa.uf}</p>
                  </div>
                )}
                {empresa.situacao && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Situação</p>
                    <p className={`text-sm font-medium ${empresa.situacao === 'ATIVA' ? 'text-green-600' : 'text-red-500'}`}>
                      {empresa.situacao}
                    </p>
                  </div>
                )}
                {empresa.porte && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Porte</p>
                    <p className="text-sm text-gray-700">{empresa.porte}</p>
                  </div>
                )}
                {empresa.dataAbertura && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Abertura</p>
                    <p className="text-sm text-gray-700">
                      {new Date(empresa.dataAbertura).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                )}
              </div>
              {empresa.atividadePrincipal && (
                <div>
                  <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-0.5">Atividade Principal</p>
                  <p className="text-sm text-gray-700">{empresa.atividadePrincipal}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            disabled={saving}
            className="btn-primary px-4 py-2 text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar CNPJ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard principal ──────────────────────────────────────────────────────
export default function Dashboard() {
  const [leads, setLeads]           = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [statusCounts, setCounts]   = useState({});
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [updatingId, setUpdating]   = useState(null);
  const [deletingId, setDeleting]   = useState(null);
  const [exporting, setExporting]   = useState(false);
  const [cnpjLead, setCnpjLead]     = useState(null); // lead com modal aberto

  // Filtros
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [sourceFilter, setSource]   = useState('');
  const [sortBy, setSortBy]         = useState('createdAt');
  const [sortOrder, setSortOrder]   = useState('desc');
  const [page, setPage]             = useState(1);

  // Debounce de busca
  const searchTimeout = useRef(null);
  const [debouncedSearch, setDebounced] = useState('');

  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(searchTimeout.current);
  }, [search]);

  useEffect(() => { setPage(1); }, [statusFilter, sourceFilter]);

  // ── Fetch ──
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/leads', {
        params: {
          page,
          limit: 20,
          search: debouncedSearch,
          status: statusFilter,
          source: sourceFilter,
          sortBy,
          sortOrder,
        },
      });
      setLeads(data.leads);
      setPagination(data.pagination);
      setCounts(data.statusCounts);
    } catch {
      setError('Não foi possível carregar os leads. Verifique a conexão com o servidor.');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, sourceFilter, sortBy, sortOrder]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // ── Stats ──
  const stats = useMemo(() => {
    const total     = pagination.total;
    const converted = statusCounts['Convertido'] ?? 0;
    const rate      = total > 0 ? Math.round((converted / total) * 100) : 0;
    return [
      { icon: Users,     label: 'Total de Leads', value: total,                            colorClass: 'bg-brand-50 text-brand-600', subLabel: 'capturados' },
      { icon: PhoneCall, label: 'Em Contato',      value: statusCounts['Em Contato'] ?? 0, colorClass: 'bg-amber-50 text-amber-600', subLabel: 'em andamento' },
      { icon: CheckCircle, label: 'Convertidos',   value: converted,                       colorClass: 'bg-green-50 text-green-600', subLabel: `${rate}% de conversão` },
      { icon: XCircle,   label: 'Perdidos',        value: statusCounts['Perdido'] ?? 0,    colorClass: 'bg-red-50 text-red-600',     subLabel: 'sem evolução' },
    ];
  }, [pagination.total, statusCounts]);

  // ── Handlers ──
  function handleSort(field) {
    if (sortBy === field) {
      setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  }

  async function handleStatusChange(id, newStatus) {
    setUpdating(id);
    try {
      await api.patch(`/leads/${id}`, { status: newStatus });
      setLeads(prev => prev.map(l => (l.id === id ? { ...l, status: newStatus } : l)));
      fetchLeads();
    } catch {
      // silencioso
    } finally {
      setUpdating(null);
    }
  }

  async function handleDelete(id, nome) {
    if (!window.confirm(`Remover o lead "${nome}"?\n\nEsta ação não pode ser desfeita.`)) return;
    setDeleting(id);
    try {
      await api.delete(`/leads/${id}`);
      fetchLeads();
    } catch {
      alert('Erro ao remover lead. Tente novamente.');
    } finally {
      setDeleting(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await api.get('/leads/export', {
        params: { search: debouncedSearch, status: statusFilter, source: sourceFilter },
        responseType: 'blob',
      });
      const url  = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `leads_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Erro ao exportar. Tente novamente.');
    } finally {
      setExporting(false);
    }
  }

  function handleCnpjSaved(id, cnpj) {
    setLeads(prev => prev.map(l => (l.id === id ? { ...l, cnpj } : l)));
  }

  function formatDate(d) {
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatCnpjDisplay(raw) {
    if (!raw) return null;
    const d = raw.replace(/\D/g, '');
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  const TABLE_COLS = [
    { key: 'nome',      label: 'Nome' },
    { key: 'email',     label: 'E-mail' },
    { key: null,        label: 'Telefone' },
    { key: null,        label: 'CNPJ' },
    { key: 'source',    label: 'Origem' },
    { key: 'status',    label: 'Status' },
    { key: 'createdAt', label: 'Cadastro' },
    { key: null,        label: '' },
  ];

  const hasFilters = search || statusFilter || sourceFilter;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">

        {/* ── Título ── */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Gestão de Leads</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Acompanhe, qualifique e converta seus leads comerciais.
          </p>
        </div>

        {/* ── Cards de estatísticas ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map(s => <StatCard key={s.label} {...s} />)}
        </div>

        {/* ── Barra de filtros ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-3">

            {/* Busca */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome ou e-mail…"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
                >×</button>
              )}
            </div>

            {/* Filtro de status */}
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <select
                value={statusFilter}
                onChange={e => setStatus(e.target.value)}
                className="pl-9 pr-8 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent appearance-none bg-white"
              >
                <option value="">Todos os status</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Filtro de origem */}
            <div className="relative">
              <select
                value={sourceFilter}
                onChange={e => setSource(e.target.value)}
                className="pl-3 pr-8 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent appearance-none bg-white"
              >
                <option value="">Todas as origens</option>
                {Object.keys(SOURCE_COLORS).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Ações */}
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={fetchLeads}
                disabled={loading}
                title="Atualizar"
                className="btn-secondary py-2.5 px-3.5 text-sm"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Atualizar</span>
              </button>

              <button
                onClick={handleExport}
                disabled={exporting || loading}
                className="btn-primary py-2.5 px-3.5 text-sm"
              >
                {exporting
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Download className="w-4 h-4" />
                }
                <span className="hidden sm:inline">Exportar CSV</span>
              </button>
            </div>
          </div>

          {/* Filtros ativos */}
          {hasFilters && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 flex-wrap">
              <span className="text-xs text-gray-400 font-medium">Filtros:</span>
              {debouncedSearch && (
                <span className="inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-700 border border-brand-200 rounded-full px-2.5 py-1 font-medium">
                  "{debouncedSearch}"
                  <button onClick={() => setSearch('')} className="ml-1 hover:text-brand-900">×</button>
                </span>
              )}
              {statusFilter && (
                <span className={`badge ${STATUS_CFG[statusFilter]?.badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_CFG[statusFilter]?.dot}`} />
                  {statusFilter}
                </span>
              )}
              {sourceFilter && <SourceBadge source={sourceFilter} />}
              <button
                onClick={() => { setSearch(''); setStatus(''); setSource(''); }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors ml-1"
              >
                Limpar filtros
              </button>
            </div>
          )}
        </div>

        {/* ── Tabela ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

          {error && (
            <div className="flex items-center gap-2.5 px-5 py-4 bg-red-50 border-b border-red-100 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
              <button
                onClick={fetchLeads}
                className="ml-auto text-red-600 hover:text-red-800 underline text-xs font-medium"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {loading && leads.length === 0 ? (
            <div className="py-20 text-center">
              <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-400 text-sm">Carregando leads…</p>
            </div>
          ) : leads.length === 0 ? (
            <EmptyState search={debouncedSearch} status={statusFilter} source={sourceFilter} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {TABLE_COLS.map((col, i) => (
                        <th
                          key={i}
                          onClick={() => col.key && handleSort(col.key)}
                          className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap ${col.key ? 'cursor-pointer hover:text-gray-800 select-none' : ''}`}
                        >
                          <div className="flex items-center gap-1.5">
                            {col.label}
                            {col.key && <SortIcon field={col.key} sortBy={sortBy} sortOrder={sortOrder} />}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-50">
                    {leads.map(lead => (
                      <tr
                        key={lead.id}
                        className={`hover:bg-gray-50 transition-colors ${deletingId === lead.id ? 'opacity-40' : ''}`}
                      >
                        {/* Nome */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <Avatar nome={lead.nome} />
                            <div>
                              <p className="font-medium text-gray-900 text-sm">{lead.nome}</p>
                              {lead.utmCampaign && (
                                <p className="text-xs text-gray-400 truncate max-w-[140px]" title={lead.utmCampaign}>
                                  📣 {lead.utmCampaign}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* E-mail */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <a
                            href={`mailto:${lead.email}`}
                            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-brand-600 transition-colors group"
                          >
                            <Mail className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-400 flex-shrink-0" />
                            {lead.email}
                          </a>
                        </td>

                        {/* Telefone */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {lead.telefone ? (
                            <a
                              href={`tel:${lead.telefone}`}
                              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-brand-600 transition-colors group"
                            >
                              <Phone className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-400 flex-shrink-0" />
                              {lead.telefone}
                            </a>
                          ) : (
                            <span className="text-gray-300 text-sm">—</span>
                          )}
                        </td>

                        {/* CNPJ */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <button
                            onClick={() => setCnpjLead(lead)}
                            title={lead.cnpj ? 'Editar / consultar CNPJ' : 'Adicionar CNPJ'}
                            className="flex items-center gap-1.5 text-sm group"
                          >
                            <Building2 className={`w-3.5 h-3.5 flex-shrink-0 ${lead.cnpj ? 'text-brand-400' : 'text-gray-200 group-hover:text-brand-300'}`} />
                            {lead.cnpj
                              ? <span className="text-gray-700 font-mono text-xs">{formatCnpjDisplay(lead.cnpj)}</span>
                              : <span className="text-gray-300 group-hover:text-brand-400 transition-colors">Adicionar</span>
                            }
                          </button>
                        </td>

                        {/* Origem */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <SourceBadge source={lead.source} />
                        </td>

                        {/* Status (select inline) */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <select
                            value={lead.status}
                            onChange={e => handleStatusChange(lead.id, e.target.value)}
                            disabled={updatingId === lead.id}
                            className={`text-xs font-semibold rounded-full px-3 py-1.5 border focus:outline-none focus:ring-2 focus:ring-brand-400 cursor-pointer transition-opacity disabled:opacity-50 ${STATUS_CFG[lead.status]?.badge ?? ''}`}
                          >
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>

                        {/* Data */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-sm text-gray-500">
                            <Calendar className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                            {formatDate(lead.createdAt)}
                          </div>
                        </td>

                        {/* Ações */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <button
                            onClick={() => handleDelete(lead.id, lead.nome)}
                            disabled={deletingId === lead.id}
                            title="Remover lead"
                            className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50 disabled:cursor-not-allowed"
                          >
                            {deletingId === lead.id
                              ? <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                              : <Trash2 className="w-4 h-4" />
                            }
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 bg-gray-50">
                  <p className="text-xs text-gray-500">
                    {Math.min((page - 1) * pagination.limit + 1, pagination.total)}
                    –
                    {Math.min(page * pagination.limit, pagination.total)}
                    {' '}de{' '}
                    <strong className="text-gray-700">{pagination.total}</strong> leads
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-gray-700 font-medium min-w-[5rem] text-center">
                      {page} / {pagination.totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                      disabled={page === pagination.totalPages}
                      className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <p className="text-xs text-gray-300 text-center mt-6">Mini CRM — Área administrativa segura</p>
      </div>

      {/* Modal CNPJ */}
      {cnpjLead && (
        <CnpjModal
          lead={cnpjLead}
          onClose={() => setCnpjLead(null)}
          onSaved={handleCnpjSaved}
        />
      )}
    </Layout>
  );
}
