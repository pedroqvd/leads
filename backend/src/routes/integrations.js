import express from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { sendMetaEvent } from '../services/metaCapi.js';

const router = express.Router();

const VALID_TYPES = ['meta', 'google', 'webhook'];

// ─── GET /api/integrations ─── Lista todas as integrações
router.get('/', requireAuth, async (req, res) => {
  try {
    const integrations = await prisma.integration.findMany({
      orderBy: { type: 'asc' },
    });

    // Parseia o config JSON para cada integração
    const result = integrations.map((i) => ({
      ...i,
      config: JSON.parse(i.config),
    }));

    res.json(result);
  } catch (err) {
    console.error('[GET /integrations]', err);
    res.status(500).json({ error: 'Erro ao buscar integrações.' });
  }
});

// ─── GET /api/integrations/:type ─── Busca integração por tipo
router.get('/:type', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Tipo inválido. Valores aceitos: ${VALID_TYPES.join(', ')}.` });
    }

    const integration = await prisma.integration.findUnique({ where: { type } });

    if (!integration) {
      // Retorna objeto vazio — integração ainda não configurada
      return res.json({ type, name: '', config: {}, active: false });
    }

    res.json({ ...integration, config: JSON.parse(integration.config) });
  } catch (err) {
    console.error('[GET /integrations/:type]', err);
    res.status(500).json({ error: 'Erro ao buscar integração.' });
  }
});

// ─── PUT /api/integrations/:type ─── Cria ou atualiza integração (upsert)
router.put('/:type', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Tipo inválido. Valores aceitos: ${VALID_TYPES.join(', ')}.` });
    }

    const { name, config, active } = req.body;

    if (typeof config !== 'object' || config === null) {
      return res.status(400).json({ error: 'config deve ser um objeto JSON.' });
    }

    const integration = await prisma.integration.upsert({
      where:  { type },
      update: {
        name:   name   ?? type,
        config: JSON.stringify(config),
        active: active ?? false,
      },
      create: {
        type,
        name:   name   ?? type,
        config: JSON.stringify(config),
        active: active ?? false,
      },
    });

    res.json({ ...integration, config: JSON.parse(integration.config) });
  } catch (err) {
    console.error('[PUT /integrations/:type]', err);
    res.status(500).json({ error: 'Erro ao salvar integração.' });
  }
});

// ─── POST /api/integrations/meta/test ─── Dispara evento de teste para a Meta CAPI
router.post('/meta/test', requireAuth, async (req, res) => {
  try {
    const integration = await prisma.integration.findUnique({ where: { type: 'meta' } });

    if (!integration || !integration.active) {
      return res.status(400).json({ error: 'Integração Meta não está ativa.' });
    }

    const config = JSON.parse(integration.config);

    if (!config.pixelId || !config.capiToken) {
      return res.status(400).json({ error: 'Pixel ID e token são obrigatórios.' });
    }

    // Lead fictício para o evento de teste
    const fakeLead = {
      id:       0,
      nome:     'Teste CRM',
      email:    'teste@exemplo.com',
      telefone: null,
      fbclid:   null,
      pageUrl:  'https://teste.local',
    };

    const result = await sendMetaEvent({
      lead:      fakeLead,
      eventName: 'Lead',
      config,
    });

    res.json({ success: true, result });
  } catch (err) {
    console.error('[POST /integrations/meta/test]', err);
    res.status(400).json({ error: err.message });
  }
});

export default router;
