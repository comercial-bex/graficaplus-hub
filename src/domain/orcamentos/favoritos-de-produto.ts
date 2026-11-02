/**
 * Favoritos de produto na escolha do orçamento (01/11/2026), no mesmo jeito dos
 * favoritos do menu: a estrela de cada pessoa fica no aparelho dela
 * (`localStorage`), por e-mail, e aparece como o primeiro atalho da escolha.
 *
 * A regra comum (ler, gravar, alternar, limite) está em
 * `domain/favoritos-no-aparelho.ts`; aqui só o prefixo da chave e os nomes
 * que a tela da escolha usa.
 */
import {
  alternarFavorito,
  chaveDosFavoritos,
  gravarFavoritos,
  lerFavoritos,
  LIMITE_DE_FAVORITOS,
  normalizarFavoritos,
} from "@/domain/favoritos-no-aparelho";

export const PREFIXO_DOS_FAVORITOS_DE_PRODUTO = "bexprint:orcamento:produtos-favoritos";
export { alternarFavorito, LIMITE_DE_FAVORITOS, normalizarFavoritos };

export function chaveDosFavoritosDeProduto(email: string | null | undefined): string {
  return chaveDosFavoritos(PREFIXO_DOS_FAVORITOS_DE_PRODUTO, email);
}

export const lerFavoritosDeProduto = lerFavoritos;
export const gravarFavoritosDeProduto = gravarFavoritos;
