import { RECURSOS, recursoPorChave, type RecursoDaApi } from "@/domain/api/recursos";
import { ACOES } from "@/domain/api/acoes";

/**
 * O MCP do Bex Print (02/11/2026), Onda 2 do "API/MCP", no padrão que o dono
 * viu no Holdprint: poucas ferramentas genéricas, leitura primeiro. Seis
 * ferramentas: descobrir, descrever, consultar, contar, somar e exemplos. Nada
 * de ação nesta onda.
 *
 * Fala JSON-RPC 2.0 pelo transporte HTTP do MCP (uma requisição, uma resposta,
 * sem sessão). O token é o mesmo da API; quem lê é a pessoa dona dele.
 */

export const VERSAO_DO_PROTOCOLO = "2025-03-26";
export const INFO_DO_SERVIDOR = { name: "bexprint", version: "1.0.0" } as const;
export const CAMINHO_DO_MCP = "/api/mcp";
/** Páginas que `somar` percorre no máximo (100 linhas cada). */
export const PAGINAS_DA_SOMA = 10;

export type FerramentaMcp = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const FILTROS_COMUNS = {
  busca: { type: "string", description: "Texto para procurar no nome, título ou número (até 80 letras)." },
  status: { type: "string", description: "Situação exata, como 'enviado' ou 'pago'. Veja os valores em bexprint_descrever." },
  cliente_id: { type: "string", description: "Id do cliente (campo id de bexprint_consultar clientes). Só orcamentos e os." },
  desde: { type: "string", description: "Data inicial AAAA-MM-DD." },
  ate: { type: "string", description: "Data final AAAA-MM-DD." },
} as const;

export const FERRAMENTAS: readonly FerramentaMcp[] = [
  {
    name: "bexprint_descobrir",
    description:
      "Descobre qual recurso do Bex Print responde a um termo em português (cliente, orçamento, OS, parcela, conta a pagar). Sem termo, lista todos. Comece por aqui.",
    inputSchema: {
      type: "object",
      properties: { termo: { type: "string", description: "Palavra ou frase do pedido, como 'orçamentos vencendo' ou 'contas de outubro'." } },
    },
  },
  {
    name: "bexprint_descrever",
    description: "Campos, filtros e valores de status de um recurso. Use antes de consultar com filtro.",
    inputSchema: {
      type: "object",
      properties: { recurso: { type: "string", enum: RECURSOS.map((r) => r.chave) } },
      required: ["recurso"],
    },
  },
  {
    name: "bexprint_consultar",
    description: "Lê registros de um recurso com filtros e página. Devolve total, limite, deslocamento e itens. Só o que a pessoa dona do token vê no sistema.",
    inputSchema: {
      type: "object",
      properties: {
        recurso: { type: "string", enum: RECURSOS.map((r) => r.chave) },
        ...FILTROS_COMUNS,
        limite: { type: "integer", minimum: 1, maximum: 100, description: "Linhas por página (padrão 50, máximo 100)." },
        deslocamento: { type: "integer", minimum: 0, description: "Quantas linhas pular." },
      },
      required: ["recurso"],
    },
  },
  {
    name: "bexprint_contar",
    description: "Conta registros de um recurso com os mesmos filtros de consultar, sem trazer as linhas.",
    inputSchema: {
      type: "object",
      properties: { recurso: { type: "string", enum: RECURSOS.map((r) => r.chave) }, ...FILTROS_COMUNS },
      required: ["recurso"],
    },
  },
  {
    name: "bexprint_somar",
    description:
      "Soma dinheiro com filtros: o campo valor de contas_receber e contas_pagar, e o valor_total de orcamentos e os (só para quem vê preços; use status para não somar rascunho com enviado). Percorre até 1.000 linhas; avisa se houve mais.",
    inputSchema: {
      type: "object",
      properties: {
        recurso: { type: "string", enum: ["contas_receber", "contas_pagar", "orcamentos", "os"] },
        status: FILTROS_COMUNS.status,
        cliente_id: FILTROS_COMUNS.cliente_id,
        desde: FILTROS_COMUNS.desde,
        ate: FILTROS_COMUNS.ate,
      },
      required: ["recurso"],
    },
  },
  {
    name: "bexprint_exemplos",
    description: "Jornadas prontas: quais ferramentas chamar, com argumentos, para pedidos comuns da gráfica.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "bexprint_acoes",
    description: "Lista as ações disponíveis (renovar orçamento vencido, mover etapa comercial, registrar nota do cliente), com os argumentos de cada uma. Toda ação roda em ensaio por padrão.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "bexprint_executar",
    description:
      "Executa uma ação em nome da pessoa dona do token. Sem confirmado=true é só ENSAIO: devolve antes e depois e não grava nada. Mostre o ensaio à pessoa e só repita com confirmado=true quando ela disser que sim.",
    inputSchema: {
      type: "object",
      properties: {
        acao: { type: "string", enum: ACOES.map((a) => a.chave) },
        argumentos: { type: "object", description: "Os argumentos da ação, como bexprint_acoes descreve." },
        confirmado: { type: "boolean", description: "false (padrão) = ensaio, nada gravado. true = grava.", default: false },
      },
      required: ["acao", "argumentos"],
    },
  },
];

/** Palavras que o vendedor e o financeiro usam, ligadas ao recurso que responde. */
const SINONIMOS: Record<string, string[]> = {
  clientes: ["cliente", "clientes", "comprador", "empresa", "cnpj", "cpf", "contato", "telefone", "whatsapp"],
  orcamentos: ["orçamento", "orcamento", "orçamentos", "orcamentos", "proposta", "cotação", "cotacao", "negociação", "negociacao", "vencendo", "validade", "enviado", "aprovado"],
  os: ["os", "ordem", "ordens", "serviço", "servico", "produção", "producao", "pedido", "pedidos", "entrega", "prazo", "kanban"],
  contas_receber: ["receber", "recebimento", "parcela", "parcelas", "cobrança", "cobranca", "pix", "pago", "pendente", "atrasado", "inadimplente", "entrada de dinheiro"],
  contas_pagar: ["pagar", "pagamento a fornecedor", "fornecedor", "despesa", "despesas", "conta", "contas", "boleto", "saída", "saida", "vencimento"],
};

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "orçamentos" e "orçamento" são a mesma palavra; palavra curta ("os") fica como está. */
const raiz = (palavra: string) => (palavra.length > 3 && palavra.endsWith("s") ? palavra.slice(0, -1) : palavra);

/**
 * Os recursos que casam com o termo, do mais ao menos provável; sem termo, todos.
 * Casa por PALAVRA inteira, não por pedaço: "os" (ordem de serviço) não pode
 * casar com o fim de "orçamentos". Sinônimo de mais de uma palavra casa como frase.
 */
export function descobrir(termo?: string | null): { recurso: RecursoDaApi; motivo: string }[] {
  const t = normalizar((termo ?? "").trim());
  if (!t) return RECURSOS.map((recurso) => ({ recurso, motivo: recurso.descricao }));
  const palavras = t.split(/[^a-z0-9]+/).filter(Boolean);
  const raizes = new Set(palavras.map(raiz));
  const frase = ` ${palavras.join(" ")} `;
  const casa = (sinonimo: string) => {
    const s = normalizar(sinonimo);
    return s.includes(" ") ? frase.includes(` ${s} `) : raizes.has(raiz(s));
  };
  const pontos = RECURSOS.map((recurso) => {
    const batidas = (SINONIMOS[recurso.chave] ?? []).filter(casa);
    return { recurso, batidas };
  })
    .filter((x) => x.batidas.length > 0)
    .sort((a, b) => b.batidas.length - a.batidas.length);
  return pontos.map((x) => ({ recurso: x.recurso, motivo: `casou com: ${x.batidas.join(", ")}` }));
}

export const VALORES_DE_STATUS: Record<string, string[]> = {
  orcamentos: ["rascunho", "enviado", "aprovado", "rejeitado", "expirado", "convertido"],
  contas_receber: ["pendente", "pago", "atrasado", "estornado"],
  contas_pagar: ["pendente", "pago", "atrasado", "cancelado"],
};

export function descrever(chave: string): Record<string, unknown> | null {
  const r = recursoPorChave(chave);
  if (!r) return null;
  return {
    recurso: r.chave,
    titulo: r.titulo,
    descricao: r.descricao,
    campos: r.campos,
    filtros: r.filtros,
    data_dos_filtros_desde_ate: r.dataDoFiltro,
    status_possiveis: VALORES_DE_STATUS[r.chave] ?? null,
    observacao: "Quem lê é a pessoa dona do token: nada além do que ela vê no sistema. Só leitura.",
  };
}

export const EXEMPLOS = [
  {
    pedido: "Quais orçamentos enviados estão esperando resposta?",
    passos: [{ ferramenta: "bexprint_consultar", argumentos: { recurso: "orcamentos", status: "enviado", limite: 50 } }],
  },
  {
    pedido: "Quanto temos a receber ainda pendente?",
    passos: [{ ferramenta: "bexprint_somar", argumentos: { recurso: "contas_receber", status: "pendente" } }],
  },
  {
    pedido: "Quanto está parado em orçamentos enviados esperando resposta?",
    passos: [{ ferramenta: "bexprint_somar", argumentos: { recurso: "orcamentos", status: "enviado" } }],
  },
  {
    pedido: "Quantos orçamentos um cliente já pediu?",
    passos: [
      { ferramenta: "bexprint_consultar", argumentos: { recurso: "clientes", busca: "parte do nome", limite: 5 } },
      { ferramenta: "bexprint_contar", argumentos: { recurso: "orcamentos", cliente_id: "id do cliente achado acima" } },
    ],
  },
  {
    pedido: "Quantas OS entraram este mês?",
    passos: [{ ferramenta: "bexprint_contar", argumentos: { recurso: "os", desde: "AAAA-MM-01", ate: "AAAA-MM-31" } }],
  },
  {
    pedido: "Achar o cliente pelo nome",
    passos: [{ ferramenta: "bexprint_consultar", argumentos: { recurso: "clientes", busca: "parte do nome", limite: 10 } }],
  },
  {
    pedido: "Contas a pagar de um mês",
    passos: [{ ferramenta: "bexprint_consultar", argumentos: { recurso: "contas_pagar", desde: "AAAA-MM-01", ate: "AAAA-MM-31", limite: 100 } }],
  },
] as const;

/** Em qual campo cada recurso guarda o dinheiro que `bexprint_somar` soma. */
export const CAMPO_DA_SOMA: Record<string, string> = {
  contas_receber: "valor",
  contas_pagar: "valor",
  orcamentos: "valor_total",
  os: "valor_total",
};

/** Soma de um campo numérico das linhas; lixo e vazio contam zero. Arredonda a centavos no fim. */
export function somarCampo(itens: readonly Record<string, unknown>[], campo: string): number {
  let soma = 0;
  for (const i of itens) {
    const n = Number(i[campo] ?? 0);
    if (Number.isFinite(n)) soma += n;
  }
  return Math.round(soma * 100) / 100;
}

/** Argumentos da ferramenta viram os mesmos filtros da URL da API, para a mesma validação. */
export function argumentosParaFiltros(args: Record<string, unknown> | undefined): URLSearchParams {
  const p = new URLSearchParams();
  for (const chave of ["busca", "status", "cliente_id", "desde", "ate", "limite", "deslocamento"]) {
    const v = args?.[chave];
    if (v === undefined || v === null || v === "") continue;
    p.set(chave, String(v));
  }
  return p;
}

export type RequisicaoJsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export function respostaJsonRpc(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

export function erroJsonRpc(id: string | number | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

/** O comando que a tela mostra para o Claude Code; SEU_TOKEN é trocado pela pessoa. */
export function comandoClaudeCode(base: string): string {
  return `claude mcp add --transport http bexprint ${base}${CAMINHO_DO_MCP} --header "Authorization: Bearer SEU_TOKEN"`;
}

/** Texto para a LLM ler e o mesmo conteúdo estruturado. */
export function conteudoDaFerramenta(objeto: unknown, erro = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(objeto, null, 2) }],
    structuredContent: typeof objeto === "object" && objeto !== null && !Array.isArray(objeto) ? (objeto as Record<string, unknown>) : { resultado: objeto },
    isError: erro,
  };
}
