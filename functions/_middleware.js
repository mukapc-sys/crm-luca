// O subdomínio do formulário abre direto no formulário: quem recebe o link
// não vê /form na URL, e o painel continua só no domínio do CRM.
export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  const host = url.hostname.toLowerCase();
  const ehFormulario = host.startsWith('form.') || host.startsWith('anamnese.');
  if (ehFormulario && (url.pathname === '/' || url.pathname === '/index.html')) {
    const destino = new URL(url);
    destino.pathname = '/form/';
    return ctx.env.ASSETS
      ? ctx.env.ASSETS.fetch(new Request(destino, ctx.request))
      : Response.redirect(destino.toString(), 302);
  }
  return ctx.next();
}
