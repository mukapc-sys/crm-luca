/* ==========================================================
   Worker de cron do CRM do Luca
   Só existe porque o Cloudflare Pages não tem agendador.
   A cada disparo ele chama uma rota do CRM, que monta a fila
   do que precisa sair e envia o que já venceu.
   Troque as duas constantes abaixo e publique.
   ========================================================== */

const CRM = 'https://crm-luca.pages.dev';   // a URL do seu Pages, sem barra no fim
const TOKEN = 'COLE_AQUI_O_TOKEN';          // copie da tela WhatsApp → Automações

async function rodar() {
  try {
    const r = await fetch(`${CRM}/api/whatsapp/processar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-token': TOKEN },
      body: JSON.stringify({ token: TOKEN }),
    });
    return await r.json().catch(() => ({ status: r.status }));
  } catch (e) { return { erro: String(e) }; }
}

export default {
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(rodar());
  },
  // abrir a URL do Worker no navegador roda na hora, para testar
  async fetch() {
    const r = await rodar();
    return new Response(JSON.stringify(r, null, 2),
      { headers: { 'content-type': 'application/json; charset=utf-8' } });
  },
};
