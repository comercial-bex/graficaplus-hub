/**
 * Ficha do cliente no desenho do Holdprint (01/11/2026): inscrições fiscais discriminadas,
 * canais de contato além do WhatsApp principal e origem do cliente. As colunas estão em
 * `supabase/migrations/20261101150000_cliente_inscricoes_e_canais.sql`.
 *
 * O WhatsApp principal (`telefone`) fica fora daqui de propósito: ele é obrigatório e
 * validado pelo banco (aa_cliente_precisa_de_whatsapp). O que está aqui é opcional.
 */

export type PossuiInscricaoEstadual = "nao_informado" | "sim" | "isento" | "nao";

export const OPCOES_DE_INSCRICAO_ESTADUAL: ReadonlyArray<{
  valor: PossuiInscricaoEstadual;
  rotulo: string;
}> = [
  { valor: "nao_informado", rotulo: "Não informado" },
  { valor: "sim", rotulo: "Sim, é contribuinte" },
  { valor: "isento", rotulo: "Isento" },
  { valor: "nao", rotulo: "Não possui" },
];

/** Só quem respondeu "sim" tem número de inscrição estadual; o banco recusa o resto. */
export function inscricaoEstadualHabilitada(possui: string | null | undefined): boolean {
  return possui === "sim";
}

export interface CamposDaFicha {
  possui_inscricao_estadual: string;
  inscricao_estadual: string;
  inscricao_municipal: string;
  telefone_2: string;
  telefone_3: string;
  email_nota_fiscal: string;
  email_boleto: string;
  site: string;
  origem: string;
}

export const FICHA_VAZIA: CamposDaFicha = {
  possui_inscricao_estadual: "nao_informado",
  inscricao_estadual: "",
  inscricao_municipal: "",
  telefone_2: "",
  telefone_3: "",
  email_nota_fiscal: "",
  email_boleto: "",
  site: "",
  origem: "",
};

const vazioParaNulo = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

export function emailValido(valor: string | null | undefined): boolean {
  const t = (valor ?? "").trim();
  return t === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t);
}

/** "www.gráfica.com" vira "https://www.gráfica.com"; texto vazio vira nulo. */
export function normalizarSite(valor: string | null | undefined): string | null {
  const t = (valor ?? "").trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

type EntradaDaFicha = Partial<Record<keyof CamposDaFicha, string | null | undefined>>;

/**
 * O que a ficha grava: texto vazio vira nulo, o site ganha o https:// e a inscrição estadual
 * só vale com "sim" (senão o banco recusa o cadastro inteiro).
 */
export function camposDaFichaParaGravar(f: EntradaDaFicha): Record<keyof CamposDaFicha, string | null> {
  const possui = (OPCOES_DE_INSCRICAO_ESTADUAL.some((o) => o.valor === f.possui_inscricao_estadual)
    ? f.possui_inscricao_estadual
    : "nao_informado") as string;
  return {
    possui_inscricao_estadual: possui,
    inscricao_estadual: inscricaoEstadualHabilitada(possui) ? vazioParaNulo(f.inscricao_estadual) : null,
    inscricao_municipal: vazioParaNulo(f.inscricao_municipal),
    telefone_2: vazioParaNulo(f.telefone_2),
    telefone_3: vazioParaNulo(f.telefone_3),
    email_nota_fiscal: vazioParaNulo(f.email_nota_fiscal),
    email_boleto: vazioParaNulo(f.email_boleto),
    site: normalizarSite(f.site),
    origem: vazioParaNulo(f.origem),
  };
}

/** O primeiro problema da ficha que impede de salvar, ou nada. */
export function problemaDaFicha(f: EntradaDaFicha): string | null {
  if (!emailValido(f.email_nota_fiscal)) return "O e-mail para a nota fiscal parece incompleto.";
  if (!emailValido(f.email_boleto)) return "O e-mail para o boleto parece incompleto.";
  return null;
}

/** Linha de leitura da inscrição estadual, para a ficha: "Sim: 12.345" ou "Isento". */
export function rotuloDaInscricaoEstadual(
  possui: string | null | undefined,
  numero: string | null | undefined,
): string {
  const opcao = OPCOES_DE_INSCRICAO_ESTADUAL.find((o) => o.valor === possui);
  if (!opcao || opcao.valor === "nao_informado") return "Não informado";
  if (opcao.valor === "sim") {
    const n = (numero ?? "").trim();
    return n ? `Sim: ${n}` : "Sim, número não informado";
  }
  return opcao.rotulo;
}

interface CadastroComContato {
  nome?: string | null;
  razao_social?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  telefone?: string | null;
  email?: string | null;
}

interface DadosDaReceita {
  razao_social: string | null;
  nome_fantasia: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  telefones: string | null;
  email: string | null;
}

/**
 * Dados da Receita num cadastro que já existe: preenche só o que está vazio, para a consulta
 * nunca trocar um endereço que alguém acertou à mão. (No cadastro novo a consulta preenche
 * por cima; aqui, na edição, não.)
 */
export function preencherSoOQueFalta<T extends CadastroComContato>(
  atual: T,
  dados: DadosDaReceita,
  formatar: { cep: (v: string) => string; telefone: (v: string) => string },
): T {
  const vazio = (v: string | null | undefined) => !(v ?? "").trim();
  return {
    ...atual,
    razao_social: vazio(atual.razao_social) ? (dados.razao_social ?? atual.razao_social ?? "") : atual.razao_social,
    nome: vazio(atual.nome) ? (dados.nome_fantasia || dados.razao_social || "") : atual.nome,
    endereco: vazio(atual.endereco) ? (dados.endereco ?? atual.endereco ?? "") : atual.endereco,
    bairro: vazio(atual.bairro) ? (dados.bairro ?? atual.bairro ?? "") : atual.bairro,
    cidade: vazio(atual.cidade) ? (dados.cidade ?? atual.cidade ?? "") : atual.cidade,
    estado: vazio(atual.estado) ? (dados.estado ?? atual.estado ?? "") : atual.estado,
    cep: vazio(atual.cep) ? (dados.cep ? formatar.cep(dados.cep) : (atual.cep ?? "")) : atual.cep,
    telefone: vazio(atual.telefone)
      ? dados.telefones
        ? formatar.telefone(dados.telefones)
        : (atual.telefone ?? "")
      : atual.telefone,
    email: vazio(atual.email) ? (dados.email ?? atual.email ?? "") : atual.email,
  };
}
