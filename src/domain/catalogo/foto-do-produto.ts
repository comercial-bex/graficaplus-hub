import type { Cadastro } from "@/domain/catalogo/pasta-do-produto";

/**
 * A foto do produto nas telas que editam (Edição rápida da lista e pasta), 04/11/2026.
 *
 * A revisão do PR 428 achou três furos no jeito como o Salvar e a tela acompanham a foto que a IA
 * grava no servidor, e a lógica ficou aqui, sem React, para ter teste de comportamento:
 *
 *   1. O Salvar só grava a foto quando ela mudou desde que a tela abriu. Mas quando a PRÓPRIA tela
 *      gerava a foto, a base de comparação não avançava: "Gerar, Remover, Salvar" mandava a foto
 *      igual à base (vazia) e não gravava nada; e, se outra pessoa enviasse a foto real depois,
 *      o Salvar regravava a gerada por cima dela. Quem gera avança a base: o banco já tem a foto.
 *   2. A pasta recarregava o cadastro inteiro do banco sempre que a linha mudava (a foto que a IA
 *      acabou de gravar muda a linha) e o texto digitado e ainda não salvo, o mesmo que a IA usou
 *      no pedido, sumia ao voltar à aba. Com edição pendente, o que a pessoa digitou fica.
 */

const texto = (v: string | null | undefined) => String(v ?? "").trim();

export const mesmaFoto = (a: string | null | undefined, b: string | null | undefined): boolean => texto(a) === texto(b);

/** O Salvar grava a foto só se ela difere da que o banco tinha (ou que a própria tela gravou). */
export const fotoMudouNaTela = (naTela: string | null | undefined, base: string | null | undefined): boolean =>
  !mesmaFoto(naTela, base);

/**
 * Depois que o servidor gravou a foto gerada, ela passa a ser a foto do banco: a tela mostra e a base
 * de comparação avança junto, para um "Remover" seguido de "Salvar" valer.
 */
export function comFotoGerada<T extends { imagem_url: string; imagem_url_aberta: string }>(f: T, url: string): T {
  return { ...f, imagem_url: url, imagem_url_aberta: url };
}

const CHAVES_DO_CADASTRO = [
  "nome",
  "descricao",
  "familia",
  "categoria",
  "tipo",
  "unidade",
  "imagem_url",
  "custo_medio",
  "preco_base",
  "margem_minima",
  "area_minima_cobrada",
  "tempo_producao_min",
  "maquina_padrao_id",
  "material_principal_id",
  "observacoes_internas",
] as const satisfies readonly (keyof Cadastro)[];

/** A pessoa mexeu em algum campo desde a última vez que o formulário veio do banco? */
export function cadastroTemEdicaoPendente(atual: Cadastro, doBancoAntes: Cadastro | null): boolean {
  if (doBancoAntes === null) return false;
  return CHAVES_DO_CADASTRO.some((k) => atual[k] !== doBancoAntes[k]);
}

/**
 * O formulário da pasta depois que o banco devolveu uma linha nova. Sem edição pendente, troca tudo
 * pelo banco. Com edição pendente, o que a pessoa digitou fica; só a foto acompanha o banco, e só se
 * a pessoa não mexeu nela (foto escolhida e ainda não salva continua valendo).
 */
export function cadastroDepoisDeRecarregar(atual: Cadastro, doBancoAntes: Cadastro | null, doBancoAgora: Cadastro): Cadastro {
  if (!cadastroTemEdicaoPendente(atual, doBancoAntes)) return doBancoAgora;
  const naoMexeuNaFoto = mesmaFoto(atual.imagem_url, doBancoAntes?.imagem_url);
  return { ...atual, imagem_url: naoMexeuNaFoto ? doBancoAgora.imagem_url : atual.imagem_url };
}
