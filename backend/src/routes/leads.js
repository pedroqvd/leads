import express from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { fireMetaEvent } from '../services/metaCapi.js';

const router = express.Router();

const VALID_STATUSES = ['Novo', 'Em Contato', 'Convertido', 'Perdido'];
const VALID_SORT_FIELDS = ['nome', 'email', 'status', 'source', 'createdAt'];

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Detecta a origem do lead com base nos parâmetros de rastreamento.
 * Prioridade: click ID > UTM source > Direct
 */
function detectSource({ fbclid, gclid, utmSource, utmMedium }) {
  if (fbclid) return 'Meta Ads';
  if (gclid) return 'Google Ads';

  if (utmSource) {
    const src = utmSource.toLowerCase();
    if (src.includes('linkedin'))  return 'LinkedIn Ads';
    if (src.includes('tiktok'))    return 'TikTok Ads';
    if (src.includes('twitter') || src.includes('x.com')) return 'X Ads';
    if (src.includes('email') || src.includes('newsletter')) return 'E-mail';
    if (src.includes('instagram')) return 'Meta Ads';
    if (src.includes('facebook'))  return 'Meta Ads';
    if (src.includes('google'))    return utmMedium === 'cpc' ? 'Google Ads' : 'Google Orgânico';
    if (src.includes('organic') || src.includes('seo')) return 'Orgânico';
    if (src.includes('referral') || src.includes('indicacao')) return 'Indicação';
    // Retorna o utmSource capitalizado como fallback
    return utmSource.charAt(0).toUpperCase() + utmSource.slice(1);
  }

  return 'Direct';
}

/** Busca configuração de integração ativa do banco */
async function getIntegrationConfig(type) {
  try {
    const integration = await prisma.integration.findFirst({
      where: { type, active: true },
    });
    if (!integration) return null;
    return JSON.parse(integration.config);
  } catch {
    return null;
  }
}

/** Monta cláusula WHERE com filtros de busca, status e source */
function buildWhere({ search, status, source }) {
  const where = {};

  if (search) {
    where.OR = [
      { nome:  { contains: search } },
      { email: { contains: search } },
    ];
  }

  if (status && VALID_STATUSES.includes(status)) {
    where.status = status;
  }

  if (source) {
    where.source = source;
  }

  return where;
}

// ─── POST /api/leads ─── Rota pública (Landing Page)
router.post('/', async (req, res) => {
  try {
    const {
      nome, email, telefone,
      utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
      fbclid, gclid,
      pageUrl,
    } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório.' });
    }

    if (!email?.trim() || !isValidEmail(email.trim())) {
      return res.status(400).json({ error: 'E-mail válido é obrigatório.' });
    }

    const emailNorm = email.toLowerCase().trim();

    // Idempotência: lead duplicado retorna sucesso sem erro visível
    const existing = await prisma.lead.findUnique({ where: { email: emailNorm } });
    if (existing) {
      return res.status(200).json({
        message: 'Obrigado! Entraremos em contato em breve.',
      });
    }

    const source = detectSource({ fbclid, gclid, utmSource, utmMedium });

    const lead = await prisma.lead.create({
      data: {
        nome:        nome.trim(),
        email:       emailNorm,
        telefone:    telefone?.trim() || null,
        source,
        utmSource:   utmSource   || null,
        utmMedium:   utmMedium   || null,
        utmCampaign: utmCampaign || null,
        utmContent:  utmContent  || null,
        utmTerm:     utmTerm     || null,
        fbclid:      fbclid      || null,
        gclid:       gclid       || null,
        pageUrl:     pageUrl     || null,
      },
    });

    // Dispara evento Lead para a Meta CAPI (fire-and-forget)
    const metaConfig = await getIntegrationConfig('meta');
    if (metaConfig) {
      fireMetaEvent({ lead, eventName: 'Lead', config: metaConfig });
    }

    res.status(201).json({
      message: 'Solicitação recebida! Entraremos em contato em breve.',
      id: lead.id,
    });
  } catch (err) {
    console.error('[POST /leads]', err);
    res.status(500).json({ error: 'Erro ao registrar solicitação.' });
  }
});

// ─── GET /api/leads/export ─── Rota protegida — exportar CSV
// DEVE vir antes de /:id para não ser interceptada como parâmetro
router.get('/export', requireAuth, async (req, res) => {
  try {
    const { search = '', status = '', source = '' } = req.query;
    const where = buildWhere({ search, status, source });

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'ID', 'Nome', 'Email', 'Telefone', 'Status', 'Origem',
      'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term',
      'fbclid', 'gclid', 'URL da Página', 'Data de Cadastro',
    ];

    const rows = leads.map((l) => [
      l.id,
      `"${l.nome.replace(/"/g, '""')}"`,
      l.email,
      l.telefone || '',
      l.status,
      l.source || 'Direct',
      l.utmSource   || '',
      l.utmMedium   || '',
      l.utmCampaign || '',
      l.utmContent  || '',
      l.utmTerm     || '',
      l.fbclid      || '',
      l.gclid       || '',
      l.pageUrl ? `"${l.pageUrl.replace(/"/g, '""')}"` : '',
      new Date(l.createdAt).toLocaleString('pt-BR'),
    ]);

    // BOM UTF-8 para Excel reconhecer a codificação
    const BOM = '\uFEFF';
    const csv = BOM + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const filename = `leads_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[GET /leads/export]', err);
    res.status(500).json({ error: 'Erro ao exportar leads.' });
  }
});

// ─── GET /api/leads ─── Rota protegida (Dashboard)
router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      source = '',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip     = (pageNum - 1) * limitNum;

    const where = buildWhere({ search, status, source });

    const orderBy = VALID_SORT_FIELDS.includes(sortBy)
      ? { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' }
      : { createdAt: 'desc' };

    const [leads, total, statusGroups, sourceGroups] = await Promise.all([
      prisma.lead.findMany({ where, skip, take: limitNum, orderBy }),
      prisma.lead.count({ where }),
      prisma.lead.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.lead.groupBy({ by: ['source'], _count: { source: true } }),
    ]);

    const statusCounts = statusGroups.reduce((acc, g) => {
      acc[g.status] = g._count.status;
      return acc;
    }, {});

    const sourceCounts = sourceGroups.reduce((acc, g) => {
      acc[g.source ?? 'Direct'] = g._count.source;
      return acc;
    }, {});

    res.json({
      leads,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
      statusCounts,
      sourceCounts,
    });
  } catch (err) {
    console.error('[GET /leads]', err);
    res.status(500).json({ error: 'Erro ao buscar leads.' });
  }
});

// ─── GET /api/leads/:id ─── Rota protegida
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });

    res.json(lead);
  } catch (err) {
    console.error('[GET /leads/:id]', err);
    res.status(500).json({ error: 'Erro ao buscar lead.' });
  }
});

// ─── PATCH /api/leads/:id ─── Rota protegida
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    const { status, notas, cnpj } = req.body;

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Status inválido. Valores aceitos: ${VALID_STATUSES.join(', ')}.`,
      });
    }

    const data = {};
    if (status !== undefined) data.status = status;
    if (notas  !== undefined) data.notas  = notas;
    if (cnpj   !== undefined) data.cnpj   = cnpj || null;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
    }

    const prevLead = await prisma.lead.findUnique({ where: { id } });
    if (!prevLead) return res.status(404).json({ error: 'Lead não encontrado.' });

    const lead = await prisma.lead.update({ where: { id }, data });

    // Dispara CompleteRegistration quando lead é convertido
    if (status === 'Convertido' && prevLead.status !== 'Convertido') {
      const metaConfig = await getIntegrationConfig('meta');
      if (metaConfig) {
        fireMetaEvent({ lead, eventName: 'CompleteRegistration', config: metaConfig });
      }
    }

    res.json(lead);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }
    console.error('[PATCH /leads/:id]', err);
    res.status(500).json({ error: 'Erro ao atualizar lead.' });
  }
});

// ─── DELETE /api/leads/:id ─── Rota protegida
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    await prisma.lead.delete({ where: { id } });
    res.json({ message: 'Lead removido com sucesso.' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }
    console.error('[DELETE /leads/:id]', err);
    res.status(500).json({ error: 'Erro ao remover lead.' });
  }
});

export default router;
