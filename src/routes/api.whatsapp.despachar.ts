import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/whatsapp/despachar — o despachante do SERVIDOR.
 *
 * A mesma rodada de POST /api/whatsapp/enviar (fila das conversas, avisos ao
 * cliente e automações), sem sessão de usuário: quem chama é o job
 * `whatsapp-despachar` do pg_cron, a cada 2 minutos, 24 h, com o token no
 * cabeçalho `x-despachante-token`. O token mora no Vault do banco e o banco
 * confere (desde 08/10/2026); a variável DESPACHANTE_TOKEN, se existir,
 * tem prioridade. Até 06/10/2026 só o
 * navegador de quem atende levava os avisos — medido: 36 min a 2 h 14 de
 * atraso, e nada à noite.
 *
 * Sem token em lugar nenhum a rota responde 503 "despachante do servidor
 * desligado" e nada muda: o despachante do navegador continua valendo.
 *
 * GET diz se está ligado (há token), sem mostrá-lo — a tela de automações lê
 * isto para avisar que as regras só disparam com alguém logado.
 *
 * O processamento vive em `whatsapp-enviar.server.ts`, importado dentro do
 * handler para o token do Z-API nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/whatsapp/despachar")({
  server: {
    handlers: {
      GET: async () => {
        const { saudeDoDespachante } = await import("@/lib/api/whatsapp-enviar.server");
        return saudeDoDespachante();
      },
      POST: async ({ request }) => {
        const { despacharPeloServidor } = await import("@/lib/api/whatsapp-enviar.server");
        return despacharPeloServidor(request);
      },
    },
  },
});
