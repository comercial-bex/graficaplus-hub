import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { armazemDoNavegador } from "@/domain/favoritos-no-aparelho";
import { novoIdLocal } from "@/lib/arquivos-no-navegador";
import {
  SELECAO_VAZIA,
  alternar,
  desmarcarVisiveis,
  dosSelecionados,
  estadoDoCabecalho,
  foraDoFiltro,
  marcarTodas,
  podarSelecao,
  type Selecao,
} from "@/domain/financeiro/selecao-de-contas";
import {
  chaveDasVisoes,
  gravarVisoes,
  lerVisoes,
  removerVisao,
  salvarVisao,
  type VisaoSalva,
} from "@/domain/financeiro/visoes-salvas";

/**
 * Os dois estados que as listas financeiras compartilham (02/11/2026): a seleção de contas e as
 * visões salvas. Os ganchos só ligam o React à regra pura de `domain/financeiro`.
 */

/**
 * Seleção por id. O que sumiu da lista (baixa, recarga) sai da seleção sozinho; mudar o filtro
 * não desmarca nada, e `fora` diz quantas marcadas o filtro de agora esconde.
 * `idDe` precisa ser estável (função de módulo), senão a poda roda a cada desenho.
 */
export function useSelecaoDeContas<T>(todas: readonly T[], visiveis: readonly T[], idDe: (t: T) => string) {
  const [selecao, setSelecao] = useState<Selecao>(SELECAO_VAZIA);

  useEffect(() => {
    setSelecao((atual) => {
      const podada = podarSelecao(atual, todas, idDe);
      return podada.size === atual.size ? atual : podada;
    });
  }, [todas, idDe]);

  const idsVisiveis = useMemo(() => visiveis.map(idDe), [visiveis, idDe]);
  const selecionadas = useMemo(() => dosSelecionados(todas, selecao, idDe), [todas, selecao, idDe]);

  return {
    selecao,
    selecionadas,
    estado: estadoDoCabecalho(selecao, idsVisiveis),
    fora: foraDoFiltro(todas, visiveis, selecao, idDe),
    alternarConta: (id: string) => setSelecao((s) => alternar(s, id)),
    alternarCabecalho: () =>
      setSelecao((s) => (estadoDoCabecalho(s, idsVisiveis) === "todas" ? desmarcarVisiveis(s, idsVisiveis) : marcarTodas(s, idsVisiveis))),
    limpar: () => setSelecao(SELECAO_VAZIA),
  };
}

/**
 * As visões de uma tela, no aparelho de quem usa (por e-mail). Lê depois de montar, para o servidor
 * e o navegador desenharem o mesmo na primeira vez. `validar` precisa ser estável (função de módulo).
 */
export function useVisoesSalvas<F>(tela: string, validar: (f: unknown) => F | null) {
  const { user } = useAuth();
  const chave = chaveDasVisoes(tela, user?.email);
  const [visoes, setVisoes] = useState<VisaoSalva<F>[]>([]);

  useEffect(() => {
    setVisoes(lerVisoes(chave, armazemDoNavegador(), validar));
  }, [chave, validar]);

  return {
    visoes,
    /** Devolve a frase do erro, ou nulo quando guardou. */
    guardar: (nome: string, filtro: F): string | null => {
      const r = salvarVisao(visoes, nome, filtro, novoIdLocal());
      if (!r.ok) return r.erro;
      setVisoes(r.lista);
      gravarVisoes(chave, r.lista, armazemDoNavegador());
      return null;
    },
    remover: (v: VisaoSalva<F>) => {
      const nova = removerVisao(visoes, v.id);
      setVisoes(nova);
      gravarVisoes(chave, nova, armazemDoNavegador());
    },
  };
}
