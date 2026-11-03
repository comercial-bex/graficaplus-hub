import type { UseQueryResult } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PASSOS_DA_EQUIPE } from "@/domain/orcamentos/passos-da-equipe";
import { Link } from "@tanstack/react-router";
import { QuemTrouxeAVenda } from "@/components/os/quem-trouxe-a-venda";
import { PrecoDoOrcamento } from "@/components/orcamento/preco-do-orcamento";
import type { AcordoDoOrcamento } from "@/components/orcamento/acordo-do-orcamento";

export function PassoCliente({
  acordo,
  canSeePrices,
  clienteRevendedor,
  extra,
  id,
  orc,
  podeEditarItens,
  tabelaDoParceiro,
}: {
  acordo: UseQueryResult<AcordoDoOrcamento | null, Error>;
  canSeePrices: boolean;
  clienteRevendedor: boolean;
  extra: any;
  id: any;
  orc: any;
  podeEditarItens: boolean;
  tabelaDoParceiro: { porProduto: Map<string, { produto_id: string; preco_referencia: number | null; preco_parceiro: number | null; faixas: Array<{ quantidade_minima: number; preco_parceiro: number; }> | null; nivel_nome: string | null; desconto_pct: number | null; }>; nivel: string | null; descontoPct: number | null; } | undefined;
}) {
  return (
    <Card id="passo-cliente" className="scroll-mt-48">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{PASSOS_DA_EQUIPE[0].pergunta}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Cliente</p>
          {extra.cliente_id && orc.cliente_nome ? (
            <Link
              to="/clientes/$id"
              params={{ id: extra.cliente_id }}
              className="text-base font-medium underline-offset-4 hover:underline"
            >
              {orc.cliente_nome}
            </Link>
          ) : (
            <p className="text-base font-medium">{orc.cliente_nome || "Sem cliente vinculado"}</p>
          )}
          {[extra.contato_nome, extra.contato_telefone, extra.contato_email].some(Boolean) && (
            <p className="mt-1 text-sm text-muted-foreground">
              {[extra.contato_nome, extra.contato_telefone, extra.contato_email]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Quem trouxe a venda
          </p>
          <QuemTrouxeAVenda alvo="orcamento" id={id} vendedorId={extra.vendedor_id ?? null} invalidar={[["orcamento", id]]} compacto />
        </div>
        {canSeePrices && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Preço para
            </p>
            <PrecoDoOrcamento
              orcamentoId={id}
              modo={acordo.data?.preco_modo ?? "cliente_final"}
              confirmadoPor={acordo.data?.preco_parceiro_confirmado_por ?? null}
              confirmadoEm={acordo.data?.preco_parceiro_confirmado_em ?? null}
              clienteRevendedor={clienteRevendedor}
              parceiroCadastrado={!!tabelaDoParceiro && tabelaDoParceiro.nivel != null}
              nivelDoParceiro={tabelaDoParceiro?.nivel ?? null}
              descontoDoParceiro={tabelaDoParceiro?.descontoPct ?? null}
              podeEditar={podeEditarItens}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
