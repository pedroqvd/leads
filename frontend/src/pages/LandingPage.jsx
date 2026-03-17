import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CheckCircle, TrendingUp, Star,
  Users, Clock, Shield, BarChart3, ChevronDown,
} from 'lucide-react';
import api from '../services/api.js';

/** Lê todos os UTM params + click IDs da URL atual */
function readTrackingParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    utmSource:   p.get('utm_source')   || undefined,
    utmMedium:   p.get('utm_medium')   || undefined,
    utmCampaign: p.get('utm_campaign') || undefined,
    utmContent:  p.get('utm_content')  || undefined,
    utmTerm:     p.get('utm_term')     || undefined,
    fbclid:      p.get('fbclid')       || undefined,
    gclid:       p.get('gclid')        || undefined,
    pageUrl:     window.location.href,
  };
}

// ─── Dados estáticos ──────────────────────────────────────────────────────────
const STATS = [
  { value: '2.000+', label: 'Clientes atendidos' },
  { value: '98%',    label: 'Taxa de satisfação' },
  { value: '3×',     label: 'Crescimento médio' },
  { value: '24h',    label: 'Retorno garantido' },
];

const BENEFITS = [
  {
    icon: BarChart3,
    title: 'Estratégia baseada em dados',
    desc: 'Análise profunda do seu mercado para decisões mais assertivas e resultados mensuráveis.',
  },
  {
    icon: Users,
    title: 'Equipe especializada',
    desc: 'Consultores com mais de 10 anos de experiência em crescimento comercial B2B e B2C.',
  },
  {
    icon: Clock,
    title: 'Resultados em 90 dias',
    desc: 'Metodologia ágil focada em entregar os primeiros resultados ainda no primeiro trimestre.',
  },
  {
    icon: Shield,
    title: 'Garantia de satisfação',
    desc: 'Sem letras miúdas. Se não houver evolução mensurável, você não paga pela consultoria.',
  },
];

const TESTIMONIALS = [
  {
    name: 'Mariana Costa',
    role: 'CEO, Innova Tech',
    text: 'Triplicamos nossa taxa de conversão em 3 meses. A abordagem deles é totalmente diferente de tudo que já vimos.',
    rating: 5,
  },
  {
    name: 'Rafael Mendes',
    role: 'Diretor Comercial, GrowBR',
    text: 'O diagnóstico gratuito já foi suficiente para mudar a forma como enxergamos nosso funil de vendas.',
    rating: 5,
  },
  {
    name: 'Juliana Alves',
    role: 'Fundadora, Studio Lab',
    text: 'Suporte incrível e entrega dentro do prazo. Recomendo sem hesitar para qualquer empresa que queira crescer.',
    rating: 5,
  },
];

// ─── Sub-componentes ──────────────────────────────────────────────────────────
function StarRating({ count = 5 }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

function SuccessState({ nome, email }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-green-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="max-w-md w-full text-center">
        <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-slide-up">
          <CheckCircle className="w-12 h-12 text-green-500" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-3">
          Solicitação recebida!
        </h2>
        <p className="text-gray-600 text-lg mb-1">
          Obrigado, <strong className="text-gray-900">{nome}</strong>!
        </p>
        <p className="text-gray-500 mb-6">
          Nossa equipe entrará em contato em até{' '}
          <strong className="text-brand-700">24 horas úteis</strong> no e-mail{' '}
          <strong className="text-gray-700">{email}</strong>.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href="/"
            className="btn-secondary text-sm px-6 py-3"
          >
            ← Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Formulário de captura ────────────────────────────────────────────────────
function LeadForm({ onSuccess }) {
  const [form, setForm]           = useState({ nome: '', email: '', telefone: '' });
  const [tracking, setTracking]   = useState({});
  const [errors, setErrors]       = useState({});
  const [loading, setLoading]     = useState(false);
  const [serverError, setServer]  = useState('');

  // Captura parâmetros de rastreamento uma única vez ao montar
  useEffect(() => {
    setTracking(readTrackingParams());
  }, []);

  function validate() {
    const e = {};
    if (!form.nome.trim())  e.nome  = 'Nome é obrigatório.';
    if (!form.email.trim()) {
      e.email = 'E-mail é obrigatório.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = 'Informe um e-mail válido.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
    if (errors[name])  setErrors(p => ({ ...p, [name]: '' }));
    if (serverError)   setServer('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      // Envia dados do formulário + parâmetros de rastreamento juntos
      await api.post('/leads', { ...form, ...tracking });
      onSuccess(form.nome, form.email);
    } catch (err) {
      setServer(err.response?.data?.error || 'Erro ao enviar. Tente novamente em instantes.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {/* Nome */}
      <div>
        <label htmlFor="nome" className="label">
          Nome completo <span className="text-red-500">*</span>
        </label>
        <input
          id="nome"
          name="nome"
          type="text"
          autoComplete="name"
          placeholder="Seu nome"
          value={form.nome}
          onChange={handleChange}
          className={`input-field ${errors.nome ? 'input-error' : ''}`}
        />
        {errors.nome && <p className="text-red-500 text-xs mt-1">{errors.nome}</p>}
      </div>

      {/* E-mail */}
      <div>
        <label htmlFor="email" className="label">
          E-mail profissional <span className="text-red-500">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="voce@empresa.com"
          value={form.email}
          onChange={handleChange}
          className={`input-field ${errors.email ? 'input-error' : ''}`}
        />
        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
      </div>

      {/* Telefone */}
      <div>
        <label htmlFor="telefone" className="label">
          Telefone / WhatsApp{' '}
          <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <input
          id="telefone"
          name="telefone"
          type="tel"
          autoComplete="tel"
          placeholder="(11) 99999-9999"
          value={form.telefone}
          onChange={handleChange}
          className="input-field"
        />
      </div>

      {serverError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <span className="mt-0.5">⚠️</span>
          <span>{serverError}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full text-base py-3.5 mt-2"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            Quero minha consultoria gratuita
            <ArrowRight className="w-5 h-5" />
          </>
        )}
      </button>

      <p className="text-xs text-gray-400 text-center pt-1">
        🔒 Sem spam. Seus dados estão protegidos.
      </p>
    </form>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function LandingPage() {
  const [successData, setSuccess] = useState(null);

  if (successData) {
    return <SuccessState nome={successData.nome} email={successData.email} />;
  }

  return (
    <div className="min-h-screen font-sans">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-gray-900 tracking-tight">Mini CRM</span>
          </div>
          <Link
            to="/login"
            className="text-sm text-brand-600 hover:text-brand-800 font-medium transition-colors flex items-center gap-1"
          >
            Área administrativa <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 text-white overflow-hidden">
        {/* decoração de fundo */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
          <div className="grid lg:grid-cols-2 gap-14 items-center">

            {/* Coluna esquerda — copy */}
            <div className="animate-slide-up">
              <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-brand-100 text-xs font-semibold px-4 py-2 rounded-full mb-6 border border-white/20">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                Consultoria comercial especializada
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] font-extrabold leading-[1.12] mb-6 tracking-tight">
                Escale suas vendas com{' '}
                <span className="text-brand-300">estratégia</span>{' '}
                e método comprovado.
              </h1>

              <p className="text-lg sm:text-xl text-brand-100 mb-10 max-w-lg leading-relaxed">
                Nossa consultoria identifica os gargalos do seu processo comercial e implementa
                um plano de ação para triplicar seus resultados em até 90 dias.
              </p>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                {STATS.map(({ value, label }) => (
                  <div key={label}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-white">{value}</div>
                    <div className="text-brand-300 text-xs mt-1 font-medium">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Coluna direita — formulário */}
            <div className="bg-white rounded-2xl p-7 sm:p-8 shadow-2xl ring-1 ring-white/10 animate-fade-in">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">
                  Agende sua consultoria gratuita
                </h2>
                <p className="text-gray-500 text-sm">
                  Preencha o formulário — retornamos em até 24 horas.
                </p>
              </div>
              <LeadForm onSuccess={(nome, email) => setSuccess({ nome, email })} />
            </div>
          </div>
        </div>

        {/* Chevron scroll hint */}
        <div className="relative flex justify-center pb-6">
          <ChevronDown className="w-6 h-6 text-brand-400 animate-bounce" />
        </div>
      </section>

      {/* ── Benefícios ── */}
      <section className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="section-title mb-4">Por que escolher nossa consultoria?</h2>
            <p className="text-gray-500 text-lg max-w-2xl mx-auto">
              Combinamos diagnóstico preciso, metodologia testada e suporte contínuo para
              que seus resultados sejam reais e sustentáveis.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {BENEFITS.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group p-6 rounded-2xl border border-gray-200 hover:border-brand-300 hover:shadow-md transition-all duration-200 hover:-translate-y-1"
              >
                <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-100 transition-colors">
                  <Icon className="w-6 h-6 text-brand-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Depoimentos ── */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="section-title mb-4">O que nossos clientes dizem</h2>
            <p className="text-gray-500 text-lg">
              Resultados reais de empresas que confiaram no nosso método.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map(({ name, role, text, rating }) => (
              <div key={name} className="card hover:shadow-md transition-shadow">
                <StarRating count={rating} />
                <p className="text-gray-700 text-sm leading-relaxed mt-4 mb-6 italic">
                  "{text}"
                </p>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{name}</p>
                  <p className="text-gray-400 text-xs">{role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="py-24 bg-brand-700 text-white text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-3xl sm:text-4xl font-extrabold mb-4 tracking-tight">
            Pronto para crescer de verdade?
          </h2>
          <p className="text-brand-200 text-lg mb-10">
            Centenas de empresas já aceleraram seus resultados. A próxima pode ser a sua.
          </p>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="bg-white text-brand-700 hover:bg-brand-50 font-bold px-8 py-4 rounded-xl text-base transition-all inline-flex items-center gap-2 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
          >
            Agendar consultoria gratuita
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-gray-950 text-gray-500 py-10 text-center text-sm">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-6 h-6 bg-brand-600 rounded-md flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-semibold text-gray-300">Mini CRM</span>
          </div>
          <p>© {new Date().getFullYear()} Mini CRM. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
