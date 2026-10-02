import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/tv/parear — a TV da Oficina pede um código de pareamento
 * ({acao:"novo"}) e, depois que um admin ou gestor aprova em /telas, retira o
 * crachá dela ({acao:"retirar"}).
 *
 * É rota pública de propósito: a TV não tem login. O que protege é o desenho —
 * o código sozinho não abre nada, o crachá só sai para quem apresenta o
 * segredo do pedido, e só depois de alguém logado aprovar.
 *
 * GET responde sem efeito colateral: serve para confirmar que a rota está
 * publicada.
 *
 * O processamento vive em `tv-parear.server.ts`, importado dentro do handler
 * para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/tv/parear")({
  server: {
    handlers: {
      GET: async () => {
        const { saudeDoPareamento } = await import("@/lib/api/tv-parear.server");
        return saudeDoPareamento();
      },
      POST: async ({ request }) => {
        const { processarPareamento } = await import("@/lib/api/tv-parear.server");
        return processarPareamento(request);
      },
    },
  },
});
