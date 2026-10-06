import { z } from "zod";

/**
 * Permissões de UMA pessoa: o que vale para ela, de onde vem, e o rastro.
 *
 * A conta de verdade mora no banco (`has_permission`): o painel não recalcula
 * o que vale, só lê `efetiva` e explica a origem. Tudo aqui é puro — sem
 * Supabase, sem React — para ser testado nos dois fusos (Belém e UTC).
 *
 *   efetiva = (chaves dos papéis ∪ dadas ativas) − tiradas ativas
 *   ativa   = sem vencimento, ou vencimento no futuro
 *
 * Exceção não vale para quem é administrador (ele tem tudo, sempre), e pessoa
 * desativada não tem nada enquanto estiver desativada.
 */

/** Belém não tem horário de verão: o fuso da casa é sempre UTC−3. */
export const FUSO_DA_CASA = "America/Belem";
const DESLOCAMENTO_DA_CASA_EM_HORAS = 3;

/* -------------------------------------------------------------------------- */
/* O que vem do banco                                                         */
/* -------------------------------------------------------------------------- */

const excecaoSchema = z.object({
  concede: z.boolean(),
  expira_em: z.string().nullable(),
  ativa: z.boolean(),
  motivo: z.string(),
  criado_em: z.string(),
  criado_por_nome: z.string().nullable(),
});

const chaveSchema = z.object({
  chave: z.string(),
  dominio: z.string(),
  descricao: z.string().nullable(),
  efetiva: z.boolean(),
  so_de_fora: z.boolean(),
  papeis: z.array(z.string()),
  excecao: excecaoSchema.nullable(),
});

const eventoSchema = z.object({
  quando: z.string(),
  acao: z.enum(["dar", "tirar", "desfazer"]),
  permissao: z.string(),
  concede: z.boolean().nullable(),
  expira_em: z.string().nullable(),
  motivo: z.string().nullable(),
  autor_nome: z.string().nullable(),
  direto_no_banco: z.boolean(),
});

const permissoesDaPessoaSchema = z.object({
  pessoa: z.object({
    id: z.string(),
    nome: z.string(),
    ativo: z.boolean(),
    papeis: z.array(z.string()),
  }),
  agora: z.string(),
  chaves: z.array(chaveSchema),
  historico: z.array(eventoSchema),
});

export type Excecao = z.infer<typeof excecaoSchema>;
export type ChaveDaPessoa = z.infer<typeof chaveSchema>;
export type EventoDoHistorico = z.infer<typeof eventoSchema>;
export type PermissoesDaPessoa = z.infer<typeof permissoesDaPessoaSchema>;

/**
 * Lê a resposta de `permissoes_da_pessoa`. Forma inesperada é ERRO, nunca
 * lista vazia: um painel vazio diria "esta pessoa não tem permissão nenhuma".
 */
export function lerPermissoesDaPessoa(json: unknown): PermissoesDaPessoa {
  const r = permissoesDaPessoaSchema.safeParse(json);
  if (!r.success) {
    throw new Error("O banco devolveu as permissões num formato que esta tela não conhece.");
  }
  return r.data;
}

const usoSchema = z.record(
  z.string(),
  z.object({ politicas: z.number(), funcoes: z.number(), visoes: z.number() }),
);

export type UsoNoBanco = z.infer<typeof usoSchema>;

/** Lê a resposta de `permissoes_uso_no_banco`. */
export function lerUsoNoBanco(json: unknown): UsoNoBanco {
  const r = usoSchema.safeParse(json);
  if (!r.success) {
    throw new Error("O banco devolveu o uso das permissões num formato que esta tela não conhece.");
  }
  return r.data;
}

/* -------------------------------------------------------------------------- */
/* Quem pode receber exceção                                                  */
/* -------------------------------------------------------------------------- */

const PAPEIS_DE_FORA = new Set(["cliente", "parceiro"]);

export function ehAdministrador(papeis: readonly string[]): boolean {
  return papeis.includes("admin");
}

/**
 * Motivo para a tela não oferecer "dar" e "tirar" a esta pessoa, ou null.
 * Espelha as recusas de `definir_excecao_permissao` — o banco recusa de
 * qualquer jeito; aqui é para não mostrar um botão que daria erro.
 */
export function motivoParaNaoTerExcecao(papeis: readonly string[]): string | null {
  if (ehAdministrador(papeis)) {
    return "O administrador tem todas as permissões, sempre: exceção não vale para ele.";
  }
  if (!papeis.some((p) => !PAPEIS_DE_FORA.has(p))) {
    return "Exceção é só para quem é da equipe. Dê um papel a esta pessoa antes.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Vencimento: "vence em 31/10" = vale até o fim do dia 31/10, em Belém        */
/* -------------------------------------------------------------------------- */

/** "AAAA-MM-DD" de hoje no fuso da casa (para o mínimo do campo de data). */
export function hojeNaCasa(agora: Date = new Date()): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_DA_CASA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/**
 * O instante em que a exceção deixa de valer, para quem escolheu "vale até
 * 31/10": 00:00 de 01/11 em Belém (03:00 UTC). Não depende do fuso do aparelho.
 */
export function expiraEmDoUltimoDia(ultimoDia: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ultimoDia);
  if (!m) throw new Error(`Data inválida: ${ultimoDia}`);
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const instante = new Date(Date.UTC(ano, mes - 1, dia + 1, DESLOCAMENTO_DA_CASA_EM_HORAS, 0, 0));
  // Date.UTC rola 31/02 para 03/03 sem reclamar: confere que a data existia.
  const conferido = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    conferido.getUTCFullYear() !== ano ||
    conferido.getUTCMonth() !== mes - 1 ||
    conferido.getUTCDate() !== dia
  ) {
    throw new Error(`Data inválida: ${ultimoDia}`);
  }
  return instante.toISOString();
}

const formatoDiaMes = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DA_CASA,
  day: "2-digit",
  month: "2-digit",
});
const formatoHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DA_CASA,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const formatoDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DA_CASA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * "31/10" para uma exceção que vence à meia-noite de 01/11 (o que a tela
 * grava), ou "07/10 às 17:12" quando o vencimento caiu no meio do dia (gravado
 * direto no banco, por exemplo).
 */
export function textoDoVencimento(expiraEm: string): string {
  const instante = Date.parse(expiraEm);
  if (Number.isNaN(instante)) return expiraEm;
  const hora = formatoHora.format(new Date(instante));
  if (hora === "00:00") return formatoDiaMes.format(new Date(instante - 1));
  return `${formatoDiaMes.format(new Date(instante))} às ${hora}`;
}

export function textoDaDataHora(iso: string): string {
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) return iso;
  return formatoDataHora.format(new Date(instante)).replace(",", "");
}

/* -------------------------------------------------------------------------- */
/* De onde vem cada chave                                                     */
/* -------------------------------------------------------------------------- */

export type Origem =
  /** Vale porque um papel da pessoa dá. */
  | { tipo: "papel"; papeis: string[] }
  /** Vale só para ela, por exceção. */
  | { tipo: "dada"; venceEm: string | null; papelJaDa: boolean }
  /** Não vale para ela, por exceção (o papel daria, ou daria se mudasse). */
  | { tipo: "tirada"; venceEm: string | null; papeis: string[] }
  /** Não vale: nenhum papel dá e não há exceção ativa. */
  | { tipo: "sem" };

export type OrigemDaChave = {
  origem: Origem;
  /** Exceção que existe mas já venceu: não conta, fica para o histórico. */
  vencida: { concede: boolean; venceuEm: string } | null;
  /** Exceção gravada numa pessoa que é administradora: não vale. */
  ignoradaPorSerAdmin: boolean;
};

export function origemDaChave(c: ChaveDaPessoa, pessoaEhAdmin: boolean): OrigemDaChave {
  const e = c.excecao;
  const vencida =
    e && !e.ativa && e.expira_em
      ? { concede: e.concede, venceuEm: textoDoVencimento(e.expira_em) }
      : null;
  const ignoradaPorSerAdmin = Boolean(e && e.ativa && pessoaEhAdmin);

  if (e && e.ativa && !pessoaEhAdmin) {
    const venceEm = e.expira_em ? textoDoVencimento(e.expira_em) : null;
    return {
      origem: e.concede
        ? { tipo: "dada", venceEm, papelJaDa: c.papeis.length > 0 }
        : { tipo: "tirada", venceEm, papeis: c.papeis },
      vencida,
      ignoradaPorSerAdmin,
    };
  }
  return {
    origem: c.papeis.length > 0 ? { tipo: "papel", papeis: c.papeis } : { tipo: "sem" },
    vencida,
    ignoradaPorSerAdmin,
  };
}

export const NOME_DO_PAPEL: Record<string, string> = {
  admin: "administrador",
  gestor: "gestor",
  financeiro: "financeiro",
  vendedor: "vendedor",
  designer: "designer",
  operador: "operador",
  estoque: "estoque",
  instalador: "instalador",
  cliente: "cliente",
  parceiro: "parceiro",
};

function listaDePapeis(papeis: readonly string[]): string {
  return papeis.map((p) => NOME_DO_PAPEL[p] ?? p).join(", ");
}

/** O selo curto ao lado da chave: "do papel (vendedor)", "dada só para esta pessoa"… */
export function rotuloDaOrigem(o: Origem): string {
  switch (o.tipo) {
    case "papel":
      return `do papel (${listaDePapeis(o.papeis)})`;
    case "dada":
      return "dada só para esta pessoa";
    case "tirada":
      return "tirada desta pessoa";
    case "sem":
      return "nenhum papel dá";
  }
}

/* -------------------------------------------------------------------------- */
/* "Ainda não faz nada"                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Uma chave FAZ ALGO quando alguma policy, função ou view do banco a cita, ou
 * quando a tela a confere (guarda de rota ou hasPermission). Sem a medição do
 * banco a resposta é "não sei" (null), nunca "não faz nada".
 */
export function fazAlgo(
  chave: string,
  uso: UsoNoBanco | null,
  usadasNaTela: ReadonlySet<string>,
): boolean | null {
  if (usadasNaTela.has(chave)) return true;
  if (!uso) return null;
  const u = uso[chave];
  if (!u) return null;
  return u.politicas + u.funcoes + u.visoes > 0;
}

/* -------------------------------------------------------------------------- */
/* Módulos                                                                    */
/* -------------------------------------------------------------------------- */

/** Nome do módulo (`permissoes.dominio`). Domínio novo cai no próprio nome. */
export const NOME_DO_MODULO: Record<string, string> = {
  admin: "Administração",
  arquivos: "Arte e arquivos",
  catalogo: "Catálogos de fornecedores",
  compras: "Compras",
  crm: "Clientes e leads",
  entregas: "Instalação (na OS)",
  estoque: "Estoque",
  financeiro: "Financeiro",
  impressao3d: "Impressão 3D",
  logistica: "Entregas e instalações",
  maquinas: "Máquinas, agenda e manutenção",
  operacao: "Produção: quadro, apontamento, qualidade e tarefas",
  orcamentos: "Orçamentos, desconto e margem",
  os: "Ordens de serviço",
  parceiros: "Parceiros revendedores",
  portal: "Portal do cliente",
  precos: "Preço de venda",
  resultado: "Custos de produção",
  whatsapp: "WhatsApp e automações",
};

export function nomeDoModulo(dominio: string): string {
  return NOME_DO_MODULO[dominio] ?? dominio.charAt(0).toUpperCase() + dominio.slice(1);
}

export type Modulo = {
  dominio: string;
  nome: string;
  chaves: ChaveDaPessoa[];
  valendo: number;
};

/** Agrupa por módulo, em ordem alfabética de nome; dentro, pela chave. */
export function agruparPorModulo(chaves: readonly ChaveDaPessoa[]): Modulo[] {
  const porDominio = new Map<string, ChaveDaPessoa[]>();
  for (const c of chaves) {
    const lista = porDominio.get(c.dominio) ?? [];
    lista.push(c);
    porDominio.set(c.dominio, lista);
  }
  return [...porDominio.entries()]
    .map(([dominio, lista]) => ({
      dominio,
      nome: nomeDoModulo(dominio),
      chaves: [...lista].sort((a, b) => a.chave.localeCompare(b.chave)),
      valendo: lista.filter((c) => c.efetiva).length,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/* -------------------------------------------------------------------------- */
/* Filtro e resumo                                                            */
/* -------------------------------------------------------------------------- */

export type Filtro = "todas" | "valendo" | "excecoes" | "sem_efeito";

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filtrarChaves(
  chaves: readonly ChaveDaPessoa[],
  filtro: Filtro,
  busca: string,
  semEfeito: (chave: string) => boolean,
): ChaveDaPessoa[] {
  const termo = semAcento(busca.trim());
  return chaves.filter((c) => {
    if (filtro === "valendo" && !c.efetiva) return false;
    if (filtro === "excecoes" && !c.excecao) return false;
    if (filtro === "sem_efeito" && !semEfeito(c.chave)) return false;
    if (!termo) return true;
    return semAcento(`${c.chave} ${c.descricao ?? ""} ${nomeDoModulo(c.dominio)}`).includes(termo);
  });
}

export type Resumo = { valendo: number; total: number; dadas: number; tiradas: number };

export function resumoDaPessoa(dados: PermissoesDaPessoa): Resumo {
  const admin = ehAdministrador(dados.pessoa.papeis);
  let dadas = 0;
  let tiradas = 0;
  for (const c of dados.chaves) {
    const { origem } = origemDaChave(c, admin);
    if (origem.tipo === "dada") dadas++;
    if (origem.tipo === "tirada") tiradas++;
  }
  return {
    valendo: dados.chaves.filter((c) => c.efetiva).length,
    total: dados.chaves.length,
    dadas,
    tiradas,
  };
}

/**
 * Nome da chave fora do módulo dela (histórico, título do diálogo, aviso).
 * 24 descrições do catálogo têm uma palavra só ("Ler", "Gerenciar"): sozinhas
 * não dizem de quê. Com até duas palavras, a chave vai junto.
 */
export function nomeDaChave(chave: string, descricao: string | null | undefined): string {
  const d = descricao?.trim();
  if (!d) return chave;
  return d.split(/\s+/).length <= 2 ? `${d} (${chave})` : d;
}

/** "SERGIO COSTA DA CRUZ" → "Sergio"; "Cibele  Oliveira" → "Cibele". */
export function primeiroNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  if (primeiro && primeiro === primeiro.toUpperCase()) {
    return primeiro.charAt(0) + primeiro.slice(1).toLowerCase();
  }
  return primeiro;
}

/* -------------------------------------------------------------------------- */
/* Histórico em frase                                                         */
/* -------------------------------------------------------------------------- */

export function textoDoEvento(e: EventoDoHistorico, descricaoDaChave?: string | null): string {
  const quem = e.direto_no_banco
    ? "Direto no banco (sem autor)"
    : (e.autor_nome ?? "Conta excluída");
  const oQue = `“${nomeDaChave(e.permissao, descricaoDaChave)}”`;
  const ate = e.expira_em ? `, até ${textoDoVencimento(e.expira_em)}` : "";
  switch (e.acao) {
    case "dar":
      return `${quem} deu ${oQue}${ate}`;
    case "tirar":
      return `${quem} tirou ${oQue}${ate}`;
    case "desfazer":
      return `${quem} desfez a exceção de ${oQue}`;
  }
}
