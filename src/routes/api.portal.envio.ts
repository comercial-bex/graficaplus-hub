import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/portal/envio — o cliente com link manda arquivo ou comprovante.
 *
 * Dois passos: {acao:"preparar"} confere o link e o pedido e devolve uma URL
 * assinada para UM caminho na pasta do cliente; o navegador sobe o arquivo
 * direto para o Storage; {acao:"confirmar"} faz o banco conferir que o arquivo
 * chegou e gravar — `arquivos` (aparece na ficha da OS) ou
 * `portal_comprovantes` (só o financeiro vê), mais a solicitação que avisa a
 * equipe. Só depois disso a resposta é 200, com o protocolo da gravação.
 *
 * O processamento vive em `portal-link.server.ts`, importado dentro do handler
 * para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/portal/envio")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { processarEnvio } = await import("@/lib/api/portal-link.server");
        return processarEnvio(request);
      },
    },
  },
});
