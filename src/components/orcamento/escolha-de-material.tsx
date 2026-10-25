import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { variantesDoMaterial } from "@/domain/orcamentos/material-do-produto";

/**
 * "Qual material?": as variações do produto do item como cartões. Não mostra nada quando o produto
 * não tem variação cadastrada. `preco` devolve o texto do preço de cada variação, ou nada para
 * quem não vê preço.
 */
export function EscolhaDeMaterial<T extends { nome: string }>({
  nomeAtual,
  catalogo,
  preco,
  desabilitado = false,
  onEscolher,
}: {
  nomeAtual: string | null | undefined;
  catalogo: readonly T[];
  preco?: (p: T) => string | undefined;
  desabilitado?: boolean;
  onEscolher: (p: T) => void;
}) {
  const v = variantesDoMaterial(nomeAtual, catalogo);
  if (!v) return null;
  return (
    <div className="space-y-1.5" data-testid="escolha-de-material">
      <span className="text-sm font-medium">{v.titulo}</span>
      <GradeDeCartoes rotulo={v.titulo}>
        {v.opcoes.map((o) => (
          <CartaoDeEscolha
            key={o.produto.nome}
            ativo={o.atual}
            titulo={o.rotulo}
            detalhe={preco?.(o.produto)}
            desabilitado={desabilitado}
            onEscolher={() => onEscolher(o.produto)}
          />
        ))}
      </GradeDeCartoes>
    </div>
  );
}
