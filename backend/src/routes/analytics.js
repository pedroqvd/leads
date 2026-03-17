import express from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// ─── GET /api/analytics ─── Métricas consolidadas
router.get('/', requireAuth, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysNum = Math.min(365, Math.max(1, Number(days)));

    const since = new Date();
    since.setDate(since.getDate() - daysNum);

    const [
      totalLeads,
      recentLeads,
      statusGroups,
      sourceGroups,
      campaignGroups,
      timelineRaw,
    ] = await Promise.all([
      // Total geral
      prisma.lead.count(),

      // Total no período
      prisma.lead.count({ where: { createdAt: { gte: since } } }),

      // Contagem por status
      prisma.lead.groupBy({ by: ['status'], _count: { status: true } }),

      // Contagem por origem
      prisma.lead.groupBy({ by: ['source'], _count: { source: true }, orderBy: { _count: { source: 'desc' } } }),

      // Contagem por campanha (apenas leads com utmCampaign)
      prisma.lead.groupBy({
        by: ['utmCampaign'],
        where: { utmCampaign: { not: null } },
        _count: { utmCampaign: true },
        orderBy: { _count: { utmCampaign: 'desc' } },
        take: 10,
      }),

      // Leads por dia no período
      prisma.lead.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Agrupa timeline por data (YYYY-MM-DD)
    const timelineMap = {};
    for (const lead of timelineRaw) {
      const day = lead.createdAt.toISOString().split('T')[0];
      timelineMap[day] = (timelineMap[day] || 0) + 1;
    }

    // Preenche dias sem leads com 0
    const timeline = [];
    for (let i = daysNum - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      timeline.push({ date: key, count: timelineMap[key] || 0 });
    }

    const statusCounts = statusGroups.reduce((acc, g) => {
      acc[g.status] = g._count.status;
      return acc;
    }, {});

    const sourceCounts = sourceGroups.map((g) => ({
      source: g.source ?? 'Direct',
      count:  g._count.source,
    }));

    const campaignCounts = campaignGroups.map((g) => ({
      campaign: g.utmCampaign,
      count:    g._count.utmCampaign,
    }));

    // Taxa de conversão
    const converted  = statusCounts['Convertido'] || 0;
    const convRate   = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : '0.0';

    res.json({
      summary: {
        totalLeads,
        recentLeads,
        converted,
        conversionRate: Number(convRate),
      },
      statusCounts,
      sourceCounts,
      campaignCounts,
      timeline,
    });
  } catch (err) {
    console.error('[GET /analytics]', err);
    res.status(500).json({ error: 'Erro ao buscar métricas.' });
  }
});

export default router;
