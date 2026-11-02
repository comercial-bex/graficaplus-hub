/**
 * A API de leitura do Bex Print (02/11/2026), Onda 1 do "API/MCP".
 *
 * O que fica aqui é o contrato que a tela de Ajustes mostra, o servidor
 * confere e o teste exercita: os recursos, os filtros que cada um aceita e a
 * leitura do token no cabeçalho. A regra de QUEM vê o quê não está aqui: o
 * banco lê como a pessoa dona do token (`api_consultar`), e a RLS decide.
 */

export const CAMINHO_BASE = "/api/v1";
export const CABECALHO_DO_TOKEN = "x-api-key";
export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 100;
export const REQUISICOES_POR_MINUTO = 100;
export const DIAS_DE_VALIDADE = [30, 90, 180, 365] as const;

export type FiltroDaApi = "busca" | "status" | "desde" | "ate" | "limite" | "deslocamento";

export type RecursoDaApi = {
  chave: string;
  titulo: string;
  /** Uma linha: o que vem e de onde. */
  descricao: string;
  campos: readonly string[];
  filtros: readonly FiltroDaApi[];
  /** A que data `desde` e `ate` se aplicam. */
  dataDoFiltro: string;
};

export const RECURSOS: readonly RecursoDaApi[] = [
  {
    chave: "clientes",
    titulo: "Clientes",
    descricao: "Clientes ativos, em ordem de nome.",
    campos: ["id", "nome", "razao_social", "documento", "telefone", "email", "cidade", "estado", "pais", "origem", "created_at"],
    filtros: ["busca", "desde", "ate", "limite", "deslocamento"],
    dataDoFiltro: "created_at",
  },
  {
    chave: "orcamentos",
    titulo: "Orçamentos",
    descricao: "Orçamentos, do mais novo ao mais antigo, sem valores nesta onda. `status`: rascunho, enviado, aprovado, rejeitado, expirado, convertido.",
    campos: ["id", "numero", "titulo", "status", "cliente_id", "contato_nome", "validade_dias", "enviado_em", "aprovado_em", "prazo", "created_at"],
    filtros: ["busca", "status", "desde", "ate", "limite", "deslocamento"],
    dataDoFiltro: "created_at",
  },
  {
    chave: "os",
    titulo: "Ordens de serviço",
    descricao: "Ordens de serviço, da mais nova à mais antiga, sem valores nesta onda.",
    campos: ["id", "numero", "titulo", "status", "cliente_id", "prazo_entrega", "setor_atual", "prioridade", "created_at"],
    filtros: ["busca", "status", "desde", "ate", "limite", "deslocamento"],
    dataDoFiltro: "created_at",
  },
  {
    chave: "contas_receber",
    titulo: "Contas a receber",
    descricao: "Parcelas a receber das OS. `status`: pendente, pago, atrasado, estornado.",
    campos: ["id", "os_id", "valor", "status", "data_vencimento", "data_pagamento", "forma_pagamento", "parcela", "total_parcelas"],
    filtros: ["status", "desde", "ate", "limite", "deslocamento"],
    dataDoFiltro: "data_vencimento",
  },
  {
    chave: "contas_pagar",
    titulo: "Contas a pagar",
    descricao: "Contas a pagar, pelo vencimento.",
    campos: ["id", "descricao", "fornecedor", "categoria", "valor", "vencimento", "data_pagamento", "status"],
    filtros: ["busca", "status", "desde", "ate", "limite", "deslocamento"],
    dataDoFiltro: "vencimento",
  },
];

export function recursoPorChave(chave: string): RecursoDaApi | null {
  return RECURSOS.find((r) => r.chave === chave) ?? null;
}

/** O token como a função do banco o gera: 'bxp_' e 48 hexadecimais. */
export function pareceToken(valor: string | null | undefined): boolean {
  return typeof valor === "string" && /^bxp_[0-9a-f]{48}$/.test(valor);
}

/** `x-api-key: bxp_…` ou `Authorization: Bearer bxp_…`. */
export function tokenDoCabecalho(headers: Headers): string | null {
  const direto = headers.get(CABECALHO_DO_TOKEN)?.trim();
  if (direto) return direto;
  const auth = headers.get("authorization")?.trim() ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  return m ? m[1] : null;
}

export type FiltrosLidos =
  | { ok: true; filtros: Record<string, string | number> }
  | { ok: false; erro: string };

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Lê e valida os filtros da URL para um recurso. Filtro que o recurso não aceita é erro, não silêncio. */
export function filtrosDaUrl(params: URLSearchParams, recurso: RecursoDaApi): FiltrosLidos {
  const filtros: Record<string, string | number> = {};
  for (const [chave, bruto] of params.entries()) {
    const valor = bruto.trim();
    if (!(recurso.filtros as readonly string[]).includes(chave)) {
      return { ok: false, erro: `O filtro "${chave}" não existe em ${recurso.chave}. Aceitos: ${recurso.filtros.join(", ")}.` };
    }
    if (chave === "limite" || chave === "deslocamento") {
      if (!/^\d+$/.test(valor)) return { ok: false, erro: `"${chave}" tem de ser um número inteiro.` };
      const n = Number(valor);
      if (chave === "limite" && (n < 1 || n > LIMITE_MAXIMO)) return { ok: false, erro: `"limite" vai de 1 a ${LIMITE_MAXIMO}.` };
      filtros[chave] = n;
      continue;
    }
    if (chave === "desde" || chave === "ate") {
      if (!DATA.test(valor) || Number.isNaN(Date.parse(valor))) return { ok: false, erro: `"${chave}" tem de ser uma data no formato AAAA-MM-DD.` };
      filtros[chave] = valor;
      continue;
    }
    if (valor.length > 80) return { ok: false, erro: `"${chave}" tem de ter até 80 letras.` };
    if (valor) filtros[chave] = valor;
  }
  if (filtros.desde && filtros.ate && String(filtros.desde) > String(filtros.ate)) {
    return { ok: false, erro: '"desde" não pode ser depois de "ate".' };
  }
  return { ok: true, filtros };
}

/** O exemplo que a tela mostra para colar no terminal. */
export function exemploCurl(base: string, recurso: string = "orcamentos"): string {
  return `curl -H "${CABECALHO_DO_TOKEN}: SEU_TOKEN" "${base}${CAMINHO_BASE}/${recurso}?limite=20"`;
}

/**
 * Janela de um minuto por token, na memória do servidor: devolve quantas
 * requisições ainda cabem, ou -1 quando estourou. `batidas` é mutado.
 */
export function restanteNaJanela(batidas: number[], agora: number, porMinuto: number = REQUISICOES_POR_MINUTO): number {
  const corte = agora - 60_000;
  while (batidas.length > 0 && batidas[0] <= corte) batidas.shift();
  if (batidas.length >= porMinuto) return -1;
  batidas.push(agora);
  return porMinuto - batidas.length;
}
