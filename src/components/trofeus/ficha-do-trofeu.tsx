import { useQuery } from "@tanstack/react-query";
import { Trophy, TriangleAlert } from "lucide-react";
import { fichaDoTrofeuDaOs } from "@/lib/api/trofeus.functions";
import { tempoEmTexto, type FichaDoTrofeu } from "@/domain/trofeus/ficha";
import { mensagemErro } from "@/lib/erros";

/**
 * A FICHA DE PRODUÇÃO DO TROFÉU na OS (22/11/2026): o que cortar, em que material e espessura, com que medida, quantas peças
 * no pedido, como cada uma é decorada, a arte e o tempo de laser. Sem preço nem custo (o operador não os vê): tudo vem de
 * `fichaDoTrofeuDaOs`, que lê com a chave de serviço depois de conferir `os.read`. OS sem troféu não mostra nada.
 */
const numero = (n: number, casas = 1) => n.toLocaleString("pt-BR", { maximumFractionDigits: casas });

function FichaDeUmTrofeu({ f }: { f: FichaDoTrofeu }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-3" data-testid="ficha-do-trofeu" aria-label={`Ficha do troféu: ${f.descricao}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-base font-semibold">
          <Trophy className="h-4 w-4 shrink-0" aria-hidden="true" />
          {f.modelo.nome} · {numero(f.alturaCm)} cm · {f.quantidade} troféu{f.quantidade === 1 ? "" : "s"}
        </h4>
        {f.urgente && (
          <span className="rounded-full border border-[color:var(--warning)] px-2 py-0.5 text-sm font-medium" data-testid="ficha-urgente">
            Urgente
          </span>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Peças no pedido</dt>
          <dd className="font-medium" data-testid="ficha-pecas-no-pedido">
            {f.pecasNoPedido} <span className="font-normal text-muted-foreground">({f.pecasPorTrofeu} por troféu)</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Acrílico</dt>
          <dd className="font-medium">{numero(f.areaM2, 3)} m²</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Contorno a cortar</dt>
          <dd className="font-medium">{numero(f.corteM, 1)} m</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Laser (estimado)</dt>
          <dd className="font-medium" data-testid="ficha-laser">
            {tempoEmTexto(f.minutosDeLaser)}
          </dd>
        </div>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Peças do troféu na altura do pedido</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-1.5 pr-3 font-medium">Peça</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Material</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Medida (cm)</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">No pedido</th>
              <th scope="col" className="py-1.5 font-medium">Decoração</th>
            </tr>
          </thead>
          <tbody>
            {f.pecas.map((p) => (
              <tr key={p.nome} className="border-b border-border last:border-0" data-testid="ficha-peca">
                <th scope="row" className="py-1.5 pr-3 text-left font-medium">{p.nome}</th>
                <td className="py-1.5 pr-3">
                  {p.material} <span className="text-muted-foreground">({numero(p.espessuraMm)} mm)</span>
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3">
                  {numero(p.larguraCm)} × {numero(p.alturaCm)}
                </td>
                <td className="py-1.5 pr-3 text-right font-medium">
                  {p.quantidadeNoPedido}
                  {p.quantidadePorTrofeu > 1 ? <span className="font-normal text-muted-foreground"> ({p.quantidadePorTrofeu} por troféu)</span> : null}
                </td>
                <td className="py-1.5">{p.decoracaoRotulo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {f.arte && (
        <p className="text-sm" data-testid="ficha-arte">
          <span className="font-medium">Arte:</span> {f.arte.tipoRotulo}
          {f.arte.alteracoesExtras > 0 ? ` · ${f.arte.alteracoesExtras} alteração${f.arte.alteracoesExtras === 1 ? "" : "ões"} extra${f.arte.alteracoesExtras === 1 ? "" : "s"}` : ""}
          {f.arte.nomesIndividuais > 0 ? ` · ${f.arte.nomesIndividuais} troféu${f.arte.nomesIndividuais === 1 ? "" : "s"} com nome individual` : ""}
        </p>
      )}

      {f.semVelocidade.length > 0 && (
        <p role="status" className="flex items-start gap-2 text-sm text-foreground" data-testid="ficha-sem-velocidade">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Sem velocidade de corte cadastrada para {f.semVelocidade.map((mm) => `${numero(mm)} mm`).join(" e ")}: o tempo de laser não foi estimado.
        </p>
      )}
      {f.provisorio && (
        <p className="text-sm text-muted-foreground" data-testid="ficha-provisoria">
          As medidas são as do modelo escaladas para a altura do pedido, ainda estimadas das imagens do modelo. Confira com a arte aprovada antes de cortar.
        </p>
      )}
    </section>
  );
}

export function FichaDoTrofeuDaOs({ osId }: { osId: string }) {
  const q = useQuery({
    queryKey: ["ficha-trofeu-os", osId],
    queryFn: () => fichaDoTrofeuDaOs({ data: { osId } }),
    staleTime: 30_000,
    retry: 1,
  });
  // Enquanto carrega e quando a OS não tem troféu: nada na tela (a maioria das OS não tem, e não deve piscar).
  if (q.isPending) return null;
  if (q.isError) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-lg border border-[color:var(--warning)] px-3 py-2 text-sm text-foreground" data-testid="ficha-falhou">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{mensagemErro(q.error)}</span>
      </p>
    );
  }
  if (!q.data || q.data.length === 0) return null;
  return (
    <div className="space-y-3" data-testid="fichas-do-trofeu">
      {q.data.map((f) => (
        <FichaDeUmTrofeu key={f.itemId} f={f} />
      ))}
    </div>
  );
}
