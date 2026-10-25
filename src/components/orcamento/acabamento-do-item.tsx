import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { alternarAcabamento, temAcabamento } from "@/domain/orcamentos/tipos-de-produto";

/**
 * Acabamento como cartões de escolha (vários podem ficar marcados), com o campo livre embaixo.
 *
 * O campo gravado continua sendo o texto (`orcamento_itens.acabamento`): os
 * cartões só escrevem nele — "bainha + ilhós, refile" — e marcam o que já está
 * escrito. Quem prefere digitar, digita; quem prefere tocar, toca.
 */
export function AcabamentoDoItem({
  valor,
  opcoes,
  onMudar,
  desabilitado = false,
}: {
  valor: string;
  opcoes: string[];
  onMudar: (valor: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="item-acabamento" className="flex items-center gap-1">
        Acabamento
        <DicaIcone
          texto={dicaCampo("/orcamentos", "acabamento")}
          rotulo="Acabamento"
          className="h-5 w-5"
        />
      </Label>
      {opcoes.length > 0 && (
        <GradeDeCartoes rotulo="Acabamentos comuns">
          {opcoes.map((o) => (
            <CartaoDeEscolha
              key={o}
              ativo={temAcabamento(valor, o)}
              titulo={o}
              desabilitado={desabilitado}
              onEscolher={() => onMudar(alternarAcabamento(valor, o))}
              className="min-h-14"
            />
          ))}
        </GradeDeCartoes>
      )}
      <Input
        id="item-acabamento"
        placeholder="Refile, ilhós…"
        value={valor}
        disabled={desabilitado}
        onChange={(e) => onMudar(e.target.value)}
      />
    </div>
  );
}
