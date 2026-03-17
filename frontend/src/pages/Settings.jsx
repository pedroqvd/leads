import React, { useState, useEffect } from 'react';
import {
  Save, TestTube2, CheckCircle, AlertCircle,
  Eye, EyeOff, Loader2,
} from 'lucide-react';
import Layout from '../components/Layout.jsx';
import api    from '../services/api.js';

// ─── Hook genérico para carregar/salvar uma integração ────────────────────────
function useIntegration(type) {
  const [config, setConfig]   = useState({});
  const [active, setActive]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get(`/integrations/${type}`)
      .then(({ data }) => {
        setConfig(data.config ?? {});
        setActive(data.active ?? false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [type]);

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.put(`/integrations/${type}`, { config, active, name: type });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  return { config, setConfig, active, setActive, loading, saving, saved, error, save };
}

// ─── Campo de texto com opcional show/hide (tokens/senhas) ────────────────────
function Field({ label, hint, value, onChange, secret = false, placeholder = '' }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          type={secret && !show ? 'password' : 'text'}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="input-field pr-10"
          autoComplete="off"
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-brand-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </div>
      <span className="text-sm font-medium text-gray-700">{label}</span>
    </label>
  );
}

function SaveBar({ saving, saved, error, onSave }) {
  return (
    <div className="flex items-center justify-between pt-4 mt-4 border-t border-gray-100 flex-wrap gap-3">
      <div>
        {saved && (
          <span className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
            <CheckCircle size={15} /> Salvo com sucesso!
          </span>
        )}
        {error && (
          <span className="flex items-center gap-1.5 text-red-600 text-sm font-medium">
            <AlertCircle size={15} /> {error}
          </span>
        )}
      </div>
      <button
        onClick={onSave}
        disabled={saving}
        className="btn-primary py-2 px-5 text-sm"
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        {saving ? 'Salvando…' : 'Salvar configurações'}
      </button>
    </div>
  );
}

// ─── Aba Meta Ads ─────────────────────────────────────────────────────────────
function MetaTab() {
  const int = useIntegration('meta');
  const [testing, setTesting] = useState(false);
  const [testResult, setTest] = useState(null);

  function field(key) {
    return {
      value:    int.config[key] ?? '',
      onChange: v => int.setConfig(c => ({ ...c, [key]: v })),
    };
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      await api.post('/integrations/meta/test');
      setTest({ ok: true, msg: 'Evento de teste enviado com sucesso! Verifique o Events Manager da Meta.' });
    } catch (err) {
      setTest({ ok: false, msg: err.response?.data?.error ?? 'Falha ao enviar evento de teste.' });
    } finally {
      setTesting(false);
    }
  }

  if (int.loading) return <div className="py-10 text-center text-gray-400 text-sm">Carregando…</div>;

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-5">
        <Field
          label="Pixel ID"
          placeholder="123456789012345"
          hint="ID numérico do seu Pixel no Gerenciador de Eventos."
          {...field('pixelId')}
        />
        <Field
          label="Token de Acesso da CAPI"
          placeholder="EAAxxxxxxxx…"
          hint="Token gerado em Gerenciador de Eventos → Configurações → Conversions API."
          secret
          {...field('capiToken')}
        />
      </div>
      <Field
        label="Código de Evento de Teste"
        placeholder="TEST12345"
        hint="Opcional. Use para validar eventos no modo de teste da Meta. Remova em produção."
        {...field('testEventCode')}
      />

      <Toggle
        label="Integração ativa"
        checked={int.active}
        onChange={int.setActive}
      />

      {/* Botão de teste */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={runTest}
          disabled={testing || !int.active}
          className="btn-secondary py-2 px-4 text-sm"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <TestTube2 size={14} />}
          Testar conexão
        </button>
        {!int.active && (
          <span className="text-xs text-gray-400">Ative a integração para testar.</span>
        )}
      </div>

      {testResult && (
        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {testResult.ok ? <CheckCircle size={15} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />}
          {testResult.msg}
        </div>
      )}

      <SaveBar saving={int.saving} saved={int.saved} error={int.error} onSave={int.save} />
    </div>
  );
}

// ─── Aba Google Ads ───────────────────────────────────────────────────────────
function GoogleTab() {
  const int = useIntegration('google');

  function field(key) {
    return {
      value:    int.config[key] ?? '',
      onChange: v => int.setConfig(c => ({ ...c, [key]: v })),
    };
  }

  if (int.loading) return <div className="py-10 text-center text-gray-400 text-sm">Carregando…</div>;

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-5">
        <Field
          label="Google Tag Manager ID"
          placeholder="GTM-XXXXXXX"
          hint="ID do contêiner do GTM. Deixe em branco se não usar GTM."
          {...field('gtmId')}
        />
        <Field
          label="Google Ads Conversion ID"
          placeholder="AW-XXXXXXXXXX"
          hint="Encontrado em Google Ads → Ferramentas → Conversões."
          {...field('conversionId')}
        />
      </div>
      <Field
        label="Conversion Label"
        placeholder="xXxXxxxxxxxxxxxxxxx"
        hint="Label específico da ação de conversão configurada no Google Ads."
        {...field('conversionLabel')}
      />

      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <strong>Nota:</strong> A integração com Google Ads é feita via Google Tag Manager (gtag.js).
        Adicione o GTM ID acima para que o CRM rastreie automaticamente os <code>gclid</code> capturados nos leads.
      </div>

      <Toggle
        label="Integração ativa"
        checked={int.active}
        onChange={int.setActive}
      />

      <SaveBar saving={int.saving} saved={int.saved} error={int.error} onSave={int.save} />
    </div>
  );
}

// ─── Aba Webhook ──────────────────────────────────────────────────────────────
function WebhookTab() {
  const int = useIntegration('webhook');

  function field(key) {
    return {
      value:    int.config[key] ?? '',
      onChange: v => int.setConfig(c => ({ ...c, [key]: v })),
    };
  }

  if (int.loading) return <div className="py-10 text-center text-gray-400 text-sm">Carregando…</div>;

  return (
    <div className="space-y-5">
      <Field
        label="URL do Webhook"
        placeholder="https://hooks.zapier.com/hooks/catch/…"
        hint="Endpoint que receberá um POST JSON para cada novo lead capturado."
        {...field('url')}
      />
      <Field
        label="Secret (opcional)"
        placeholder="meu-segredo-seguro"
        hint="Enviado no header X-Webhook-Secret para validar a autenticidade das requisições."
        secret
        {...field('secret')}
      />

      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
        <strong>Payload enviado:</strong> <code className="bg-blue-100 px-1 rounded">{"{ id, nome, email, telefone, source, utmSource, utmCampaign, createdAt }"}</code>
      </div>

      <Toggle
        label="Webhook ativo"
        checked={int.active}
        onChange={int.setActive}
      />

      <SaveBar saving={int.saving} saved={int.saved} error={int.error} onSave={int.save} />
    </div>
  );
}

// ─── Página Settings ──────────────────────────────────────────────────────────
const TABS = [
  { id: 'meta',    label: 'Meta Ads' },
  { id: 'google',  label: 'Google Ads' },
  { id: 'webhook', label: 'Webhook' },
];

export default function Settings() {
  const [tab, setTab] = useState('meta');

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
          <p className="text-gray-500 mt-1 text-sm">Integre o CRM com suas plataformas de anúncios e ferramentas externas.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-8">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-brand-600 text-brand-700 bg-brand-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Conteúdo da aba */}
        <div className="card">
          {tab === 'meta'    && <MetaTab />}
          {tab === 'google'  && <GoogleTab />}
          {tab === 'webhook' && <WebhookTab />}
        </div>
      </div>
    </Layout>
  );
}
