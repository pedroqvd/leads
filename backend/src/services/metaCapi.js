/**
 * Meta Conversions API (CAPI) — Server-Side Events
 *
 * Envia eventos de conversão diretamente do servidor para a Meta,
 * sem depender do pixel do navegador. Isso melhora a atribuição
 * mesmo quando o usuário usa bloqueadores de anúncios.
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
 */
import crypto from 'crypto';

/** SHA-256 normalizado — padrão exigido pela Meta */
function hash(value) {
  if (!value) return undefined;
  return crypto
    .createHash('sha256')
    .update(String(value).toLowerCase().trim())
    .digest('hex');
}

/** Remove tudo que não for dígito e adiciona código do país se ausente */
function normalizePhone(phone) {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  // Adiciona +55 se não começar com código de país
  return digits.startsWith('55') ? digits : `55${digits}`;
}

/**
 * Monta o fbp/fbc a partir do fbclid capturado na URL.
 * Formato: fb.{version}.{creationTime}.{fbclid}
 */
function buildFbc(fbclid) {
  if (!fbclid) return undefined;
  return `fb.1.${Date.now()}.${fbclid}`;
}

/**
 * Envia um evento para a Meta Conversions API.
 *
 * @param {object} params
 * @param {object} params.lead      - Objeto lead do banco de dados
 * @param {string} params.eventName - Nome do evento Meta (Lead, CompleteRegistration, Contact…)
 * @param {object} params.config    - Config da integração { pixelId, capiToken, testEventCode }
 *
 * @returns {Promise<{ skipped?: boolean, events_received?: number }>}
 */
export async function sendMetaEvent({ lead, eventName, config }) {
  const { pixelId, capiToken, testEventCode } = config ?? {};

  if (!pixelId || !capiToken) {
    return { skipped: true, reason: 'Pixel ID ou token não configurados.' };
  }

  const [firstName, ...rest] = lead.nome.trim().split(/\s+/);
  const lastName = rest.join(' ');

  const userData = {
    em:  [hash(lead.email)],
    fn:  [hash(firstName)],
    ...(lastName          && { ln:  [hash(lastName)] }),
    ...(lead.telefone     && { ph:  [hash(normalizePhone(lead.telefone))] }),
    ...(lead.fbclid       && { fbc: buildFbc(lead.fbclid) }),
  };

  const payload = {
    data: [
      {
        event_name:        eventName,
        event_time:        Math.floor(Date.now() / 1000),
        action_source:     'website',
        event_source_url:  lead.pageUrl ?? '',
        user_data:         userData,
        custom_data: {
          lead_id:    String(lead.id),
          utm_source:   lead.utmSource   ?? undefined,
          utm_campaign: lead.utmCampaign ?? undefined,
          utm_medium:   lead.utmMedium   ?? undefined,
        },
      },
    ],
    ...(testEventCode && { test_event_code: testEventCode }),
  };

  const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${capiToken}`;

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(`Meta CAPI error: ${JSON.stringify(result?.error ?? result)}`);
  }

  return result;
}

/**
 * Wrapper que dispara o evento sem bloquear a resposta HTTP (fire-and-forget).
 * Erros são apenas logados — nunca propagados para o cliente.
 */
export function fireMetaEvent(params) {
  sendMetaEvent(params).catch(err =>
    console.error(`[Meta CAPI] Falha ao enviar evento "${params.eventName}":`, err.message)
  );
}
