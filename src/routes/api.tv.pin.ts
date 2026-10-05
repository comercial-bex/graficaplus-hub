import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/tv/pin — a TV da Oficina se libera digitando o PIN na própria tela.
 *
 * GET diz se a entrada por PIN está ligada e quantas casas o teclado tem.
 * POST {pin, token} confere o PIN no banco e, se estiver certo, transforma o
 * token que a TV sorteou num crachá dela (o mesmo das TVs pareadas por
 * código, revogável em /telas).
 *
 * É rota pública de propósito: a TV não tem login. O que protege é o desenho —
 * o PIN só existe no banco como hash bcrypt, cinco erros do mesmo endereço (ou
 * trinta no total) em 15 minutos fazem a entrada esperar, e trocar o PIN em
 * /telas desconecta quem entrou com o antigo.
 *
 * O processamento vive em `tv-pin.server.ts`, importado dentro do handler
 * para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/tv/pin")({
  server: {
    handlers: {
      GET: async () => {
        const { estadoDoPin } = await import("@/lib/api/tv-pin.server");
        return estadoDoPin();
      },
      POST: async ({ request }) => {
        const { entrarComPin } = await import("@/lib/api/tv-pin.server");
        return entrarComPin(request);
      },
    },
  },
});
