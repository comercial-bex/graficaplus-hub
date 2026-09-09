import { AlertTriangle } from "lucide-react";
import {
  espacoDeNegociacao,
  fatiasDoPreco,
  type EntradaComposicao,
} from "@/domain/orcamentos/composicao-do-preco";

/**
 * Para onde vai cada real que o cliente paga — e até onde dá para baixar.
 *
 * O resumo em números soltos responde "quanto custa". Na frente do cliente a
 * pergunta é outra: quanto ainda cabe de desconto. Esta barra responde as duas
 * de uma vez, porque mostra a proporção junto com os dois limites:
 *
 *   até o MÍNIMO   desconto que o vendedor dá sozinho
 *   até o PISO     entre um e outro, é decisão de quem manda
 *   abaixo do PISO pagar para trabalhar
 */

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

// Cor por papel, não por posição: custo em tons frios de intensidade crescente,
// imposto em âmbar, lucro em verde, prejuízo em vermelho. Quem olha de longe
// entende a barra antes de ler os rótulos.
const COR: Record<string, string> = {
  materiais: "bg-sky-600",
  processos: "bg-indigo-500",
  maoDeObra: "bg-violet-500",
  outros: "bg-slate-400",
  taxas: "bg-amber-500",
  lucro: "bg-emerald-500",
  prejuizo: "bg-destructive",
};

export function BarraDeComposicao({
  resultado,
  taxasVendaPct,
  margemMinima = 0.3,
  quantidade = 1,
}: {
  resultado: EntradaComposicao;
  taxasVendaPct: number;
  /** margem líquida que a casa aceita trabalhar — decisão, não conta */
  margemMinima?: number;
  quantidade?: number;
}) {
  const fatias = fatiasDoPreco(resultado);
  if (fatias.length === 0 || resultado.precoFinal <= 0) return null;

  const e = espacoDeNegociacao({
    precoFinal: resultado.precoFinal,
    custoTotal: resultado.custoTotal,
    taxasVendaPct,
    margemMinima,
  });

  const porPeca = (v: number) => (quantidade > 1 ? ` · ${brl(v / quantidade)} por peça` : "");

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">Para onde vai o preço</h4>
        <span className="font-mono text-sm font-bold">{brl(resultado.precoFinal)}</span>
      </div>

      {/* A barra. `flex` com largura proporcional em vez de grid: no prejuízo a
          soma passa de 100% e as faixas transbordam de propósito — encolher
          esconderia justamente o caso que precisa gritar. */}
      <div className="flex h-7 w-full overflow-hidden rounded-md border">
        {fatias.map((f) => (
          <div
            key={f.chave}
            className={`${COR[f.chave]} flex items-center justify-center overflow-hidden`}
            style={{ width: `${Math.max(f.fracao * 100, 0)}%` }}
            title={`${f.rotulo}: ${brl(f.valor)} (${pct(f.fracao)})`}
          >
            {f.fracao > 0.11 && (
              <span className="px-1 text-[10px] font-medium text-white whitespace-nowrap">
                {pct(f.fracao)}
              </span>
            )}
          </div>
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {fatias.map((f) => (
          <li key={f.chave} className="flex items-center gap-1.5 text-xs">
            <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-sm ${COR[f.chave]}`} />
            <span className="text-muted-foreground">{f.rotulo}</span>
            <span className="ml-auto font-mono tabular-nums">{brl(f.valor)}</span>
          </li>
        ))}
      </ul>

      {/* Os dois limites, com o que cada um significa para quem negocia. */}
      <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
        {e.abaixoDoPiso ? (
          <p className="flex gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              Este preço está <strong>abaixo do piso</strong> de {brl(e.piso)}. Cada peça
              vendida assim sai do bolso da casa.
            </span>
          </p>
        ) : e.abaixoDoMinimo ? (
          // Não faz sentido oferecer desconto "até" um valor MAIOR que o preço
          // atual. Aqui o único limite que resta é o piso.
          <>
            <p className="text-amber-600">
              Já está abaixo da margem de {pct(margemMinima)} que a casa trabalha — a
              {" "}{pct(margemMinima)} este item sairia por{" "}
              <strong className="font-mono">{brl(e.minimo ?? 0)}</strong>.
            </p>
            <p className="text-muted-foreground">
              Ainda paga as contas: o lucro só zera em{" "}
              <strong className="font-mono">{brl(e.piso)}</strong>, e daqui até lá cabem{" "}
              <strong className="font-mono">{brl(e.descontoAtePiso)}</strong> ({pct(e.descontoAtePisoPct)}).
              Descer nessa faixa é decisão de quem manda, não desconto de rotina.
            </p>
          </>
        ) : (
          <>
            <p>
              Dá para baixar até <strong className="font-mono">{brl(e.minimo ?? e.piso)}</strong>{" "}
              mantendo {pct(margemMinima)} de margem — são{" "}
              <strong className="font-mono">{brl(e.descontoAteMinimo)}</strong> ({pct(e.descontoAteMinimoPct)})
              de desconto{porPeca(e.descontoAteMinimo)}.
            </p>
            <p className="text-muted-foreground">
              O lucro zera em <strong className="font-mono">{brl(e.piso)}</strong>: entre um
              valor e outro ainda paga as contas, mas é decisão de quem manda, não desconto
              de rotina.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
