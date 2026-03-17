import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function sanitizeCnpj(raw) {
  return raw.replace(/\D/g, '');
}

function formatCnpj(digits) {
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5'
  );
}

// GET /api/cnpj/:cnpj — consulta Receita via BrasilAPI (requer autenticação)
router.get('/:cnpj', requireAuth, async (req, res) => {
  const digits = sanitizeCnpj(req.params.cnpj);

  if (digits.length !== 14) {
    return res.status(400).json({ error: 'CNPJ inválido. Informe 14 dígitos.' });
  }

  try {
    const response = await fetch(
      `https://brasilapi.com.br/api/cnpj/v1/${digits}`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (response.status === 404) {
      return res.status(404).json({ error: 'CNPJ não encontrado na Receita Federal.' });
    }

    if (!response.ok) {
      return res.status(502).json({ error: 'Erro ao consultar Receita Federal. Tente novamente.' });
    }

    const data = await response.json();

    // Retorna apenas os campos relevantes para o CRM
    res.json({
      cnpj:             formatCnpj(digits),
      razaoSocial:      data.razao_social,
      nomeFantasia:     data.nome_fantasia || null,
      situacao:         data.descricao_situacao_cadastral,
      dataAbertura:     data.data_inicio_atividade,
      naturezaJuridica: data.natureza_juridica,
      atividadePrincipal: data.cnae_fiscal_descricao || null,
      porte:            data.porte,
      municipio:        data.municipio,
      uf:               data.uf,
      email:            data.email || null,
      telefone:         data.ddd_telefone_1
        ? `(${data.ddd_telefone_1}) ${data.telefone_1 || ''}`.trim()
        : null,
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Consulta à Receita Federal expirou. Tente novamente.' });
    }
    console.error('[GET /cnpj]', err);
    res.status(500).json({ error: 'Erro interno ao consultar CNPJ.' });
  }
});

export default router;
