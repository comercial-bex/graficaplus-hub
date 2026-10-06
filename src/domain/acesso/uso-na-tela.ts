import { routePermissions } from "@/lib/permissions";

/**
 * Chaves que a TELA confere com `hasPermission("…")` (botões, abas, avisos),
 * fora das guardas de rota. Junto com o que o banco cita (policies, funções e
 * views, medido ao vivo por `permissoes_uso_no_banco`), é o que separa uma
 * chave que faz algo de uma que "ainda não faz nada".
 *
 * Não dá para ler o código-fonte de dentro do navegador, então a lista é
 * escrita aqui — e tests/permissoes-por-pessoa.test.ts varre `src` e reprova
 * se ela ficar para trás (chave nova conferida na tela e esquecida aqui) ou
 * sobrar (chave que nenhuma tela confere mais). Medida em 06/10/2026.
 */
export const CHAVES_CONFERIDAS_NA_TELA: readonly string[] = [
  "agenda.operate",
  "agenda.schedule",
  "arquivos.finalize",
  "arquivos.request_approval",
  "automacoes.manage",
  "catalogo.manage",
  "clientes.update",
  "compras.cancel",
  "compras.create",
  "compras.receive",
  "configuracoes.manage",
  "custos.read",
  "custos.update",
  "entregas.manage",
  "estoque.adjust",
  "estoque.cost.read",
  "estoque.entry",
  "estoque.inventory",
  "estoque.reserve",
  "financeiro.read",
  "impressao3d.cost.read",
  "kanban.move",
  "leads.convert",
  "leads.create",
  "leads.read",
  "leads.update",
  "maquinas.manage",
  "orcamentos.convert",
  "orcamentos.create",
  "orcamentos.read",
  "orcamentos.send",
  "orcamentos.update",
  "os.create",
  "os.update",
  "pagamentos.confirm",
  "pagamentos.create",
  "pagamentos.reverse",
  "pagamentos.update",
  "parceiros.manage",
  "portal.read",
  "precos.read",
  "producao.finish",
  "producao.start",
  "qualidade.manage",
  "tarefas.complete",
  "tarefas.create",
  "tarefas.reopen",
  "templates.manage",
  "whatsapp.manage",
  "whatsapp.read",
  "whatsapp.reply",
];

/** Guardas de rota (lidas do mapa de rotas, sempre atual) + conferências da tela. */
export function chavesUsadasNaTela(): Set<string> {
  const usadas = new Set<string>(CHAVES_CONFERIDAS_NA_TELA);
  for (const rota of routePermissions) for (const chave of rota.permissions) usadas.add(chave);
  return usadas;
}
