import {
  chaveDoTipo,
  type ChaveDoTipo,
  type ProdutoClassificavel,
} from "@/domain/orcamentos/tipos-de-produto";

/**
 * A lista de produtos por família, como o "Produtos e Serviços" do Custeio do
 * Holdprint (02/11/2026): famílias à esquerda, com desenho e contagem; produtos
 * à direita. A família é texto livre no cadastro (`produtos.familia`), então
 * aqui ela é lida do que existe, não de uma lista fixa. Quem não tem família
 * entra em "Sem família", no fim, para ninguém sumir da tela.
 *
 * Estas regras não têm tela: o teste as lê sem navegador.
 */

export const SEM_FAMILIA = "Sem família";

/** O nome que a proposta mostra para cada unidade do cadastro. */
export const UNIDADES_NA_PROPOSTA: Record<string, string> = {
  m2: "Metros quadrados (m²)",
  un: "Unidade",
  m: "Metro linear",
  hora: "Hora",
  h: "Hora",
  peca: "Peça",
  kg: "Quilo",
  lote: "Lote",
  mil: "Milheiro",
  km: "Quilômetro",
};

function unidadeNormalizada(unidade: string | null | undefined): string {
  return (unidade ?? "").trim().toLowerCase().replace("²", "2");
}

/** "m2" vira "Metros quadrados (m²)"; unidade desconhecida volta como está. */
export function rotuloDaUnidade(unidade: string | null | undefined): string {
  const u = unidadeNormalizada(unidade);
  return UNIDADES_NA_PROPOSTA[u] ?? (unidade ?? "").trim();
}

/**
 * O "modelo de engenharia de custo" do Holdprint é, para nós, a base da conta:
 * é a unidade que diz se o preço anda pela área, pela peça, pelo metro ou pela
 * hora. Dizer isso em palavras na pasta evita a pergunta "por que este produto
 * pede largura e altura?".
 */
export function baseDeCalculo(unidade: string | null | undefined): string {
  switch (unidadeNormalizada(unidade)) {
    case "m2":
      return "Por área: largura × altura × cópias, com a área mínima quando houver";
    case "m":
      return "Por metro linear: a medida da peça × cópias";
    case "hora":
    case "h":
      return "Por hora: as horas informadas no item";
    case "km":
      return "Por quilômetro: a distância informada no item";
    case "mil":
      return "Por milheiro: a quantidade em milhares";
    case "kg":
      return "Por quilo: o peso informado no item";
    case "lote":
      return "Por lote: a quantidade de lotes";
    default:
      return "Por peça: a quantidade × o preço de cada uma";
  }
}

export type ProdutoDaLista = ProdutoClassificavel & { id: string; ativo: boolean };

export type FamiliaDaLista = {
  /** Nulo é o grupo "Sem família". */
  familia: string | null;
  nome: string;
  quantidade: number;
  /** O desenho: o tipo mais comum entre os produtos da família. */
  chave: ChaveDoTipo;
};

function familiaDoProduto(
  p: { id: string },
  familiaDe: ReadonlyMap<string, string>,
): string | null {
  const f = (familiaDe.get(p.id) ?? "").trim();
  return f === "" ? null : f;
}

/** As famílias que aparecem na coluna, em ordem alfabética; "Sem família" no fim, só se existir. */
export function familiasDaLista<P extends ProdutoDaLista>(
  produtos: readonly P[],
  familiaDe: ReadonlyMap<string, string>,
  opcoes: { mostrarInativos: boolean } = { mostrarInativos: false },
): FamiliaDaLista[] {
  const grupos = new Map<string | null, { quantidade: number; chaves: Map<ChaveDoTipo, number> }>();
  for (const p of produtos) {
    if (!opcoes.mostrarInativos && !p.ativo) continue;
    const familia = familiaDoProduto(p, familiaDe);
    const g = grupos.get(familia) ?? { quantidade: 0, chaves: new Map() };
    g.quantidade += 1;
    const chave = chaveDoTipo(p);
    g.chaves.set(chave, (g.chaves.get(chave) ?? 0) + 1);
    grupos.set(familia, g);
  }
  const linhas: FamiliaDaLista[] = [];
  for (const [familia, g] of grupos) {
    const chave = [...g.chaves.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "outros";
    linhas.push({ familia, nome: familia ?? SEM_FAMILIA, quantidade: g.quantidade, chave });
  }
  return linhas.sort((a, b) => {
    if (a.familia === null) return 1;
    if (b.familia === null) return -1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

/** Os produtos da família escolhida; nulo é "todas"; SEM_FAMILIA é quem não tem família. */
export function filtrarPorFamiliaDaLista<P extends { id: string }>(
  produtos: readonly P[],
  familiaDe: ReadonlyMap<string, string>,
  escolhida: string | null,
): P[] {
  if (escolhida === null) return [...produtos];
  if (escolhida === SEM_FAMILIA) return produtos.filter((p) => familiaDoProduto(p, familiaDe) === null);
  return produtos.filter((p) => familiaDoProduto(p, familiaDe) === escolhida);
}

export type PlanoDeRenomear =
  | { ok: true; de: string; para: string; quantidade: number; junta: boolean; jaTem: number }
  | { ok: false; erro: string };

/**
 * "Editar famílias" do Holdprint: renomear uma família muda todos os produtos
 * dela de uma vez. Se o novo nome já existe, as duas viram uma só, e a tela
 * diz quantos produtos cada lado tem antes de a pessoa confirmar.
 */
export function planoDeRenomear(
  de: string,
  para: string,
  familias: readonly FamiliaDaLista[],
): PlanoDeRenomear {
  const origem = familias.find((f) => f.familia === de);
  const novo = para.trim();
  if (!origem || origem.familia === null) return { ok: false, erro: "Escolha a família que vai mudar." };
  if (novo === "") return { ok: false, erro: "Escreva o novo nome da família." };
  if (novo === de) return { ok: false, erro: "O nome é o mesmo de antes." };
  if (novo === SEM_FAMILIA) return { ok: false, erro: `"${SEM_FAMILIA}" não é um nome de família.` };
  const destino = familias.find((f) => f.familia === novo);
  return {
    ok: true,
    de,
    para: novo,
    quantidade: origem.quantidade,
    junta: !!destino,
    jaTem: destino?.quantidade ?? 0,
  };
}

/** A frase do plano, para a pessoa saber o que vai acontecer antes de confirmar. */
export function fraseDoPlano(plano: PlanoDeRenomear): string {
  if (!plano.ok) return plano.erro;
  const n = plano.quantidade;
  const produtos = n === 1 ? "1 produto" : `${n} produtos`;
  if (plano.junta) {
    const m = plano.jaTem;
    return `Junta ${produtos} de "${plano.de}" à família "${plano.para}", que já tem ${m === 1 ? "1 produto" : `${m} produtos`}.`;
  }
  return `Renomeia "${plano.de}" para "${plano.para}" em ${produtos}.`;
}
