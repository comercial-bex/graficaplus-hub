import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adicionarAoCarrinho,
  alterarQuantidade,
  chaveDeArmazenamento,
  lerCarrinho,
  linhaDoCarrinho,
  removerDoCarrinho,
  resumoDoCarrinho,
  serializarCarrinho,
  type Carrinho,
} from "@/domain/catalogo/carrinho";
import type { ItemDaLoja, OpcaoDaLoja } from "@/domain/catalogo/loja";

/**
 * O carrinho no aparelho: `localStorage`, um por escopo (a equipe tem o seu;
 * cada link do cliente, o seu). Toda leitura e gravação fica dentro de
 * try/catch — modo privado, armazenamento cheio ou bloqueado não derrubam a
 * loja: o carrinho só vive na memória até a página fechar.
 */
export function useCarrinho(escopo: string) {
  const chave = chaveDeArmazenamento(escopo);
  const [carrinho, setCarrinho] = useState<Carrinho>([]);
  const [lido, setLido] = useState(false);

  useEffect(() => {
    let guardado: string | null = null;
    try {
      guardado = window.localStorage.getItem(chave);
    } catch {
      guardado = null;
    }
    setCarrinho(lerCarrinho(guardado));
    setLido(true);
  }, [chave]);

  useEffect(() => {
    if (!lido) return;
    try {
      if (carrinho.length === 0) window.localStorage.removeItem(chave);
      else window.localStorage.setItem(chave, serializarCarrinho(carrinho));
    } catch {
      // Sem armazenamento: o carrinho vive só nesta página.
    }
  }, [carrinho, chave, lido]);

  const adicionar = useCallback((item: ItemDaLoja, opcao: OpcaoDaLoja, quantidade: number) => {
    setCarrinho((atual) => adicionarAoCarrinho(atual, linhaDoCarrinho(item, opcao, quantidade)));
  }, []);
  const mudarQuantidade = useCallback((chaveDaLinha: string, quantidade: number) => {
    setCarrinho((atual) => alterarQuantidade(atual, chaveDaLinha, quantidade));
  }, []);
  const remover = useCallback((chaves: string | string[]) => {
    const lista = Array.isArray(chaves) ? chaves : [chaves];
    setCarrinho((atual) => lista.reduce((c, chave) => removerDoCarrinho(c, chave), atual));
  }, []);
  const limpar = useCallback(() => setCarrinho([]), []);
  const resumo = useMemo(() => resumoDoCarrinho(carrinho), [carrinho]);

  return { carrinho, resumo, adicionar, mudarQuantidade, remover, limpar };
}
