import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Circle, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PainelDoParceiro } from "@/domain/parceiros/painel";

/**
 * O caminho do primeiro dia, para quem nunca usou o painel.
 *
 * Cada passo é lido do próprio dado — ninguém marca nada à mão — e o cartão
 * inteiro some quando os três estão feitos. Parceiro é gente de fora: se a
 * primeira tela não disser o que fazer, ele fecha e volta a pedir preço por
 * WhatsApp, que é justamente o trabalho que este painel tira da gráfica.
 */
export function PrimeirosPassos({ painel }: { painel: PainelDoParceiro }) {
  const temMarca = !!(painel.marca.logo_path || (painel.marca.nome ?? "").trim());
  const temOrcamento = painel.orcamentos.total > 0;
  const temPedido = painel.orcamentos.pedidos > 0;

  const passos = [
    {
      feito: temMarca,
      titulo: "Coloque a sua marca",
      texto: "Logo, telefone e cor. É o que sai no PDF que o seu cliente recebe.",
      para: "/parceiro/marca" as const,
      acao: "Abrir minha marca",
    },
    {
      feito: temOrcamento,
      titulo: "Faça o primeiro orçamento",
      texto: "Escolha o produto na sua tabela, coloque a medida e o seu preço. O PDF sai com a sua marca.",
      para: "/parceiro/orcamentos" as const,
      acao: "Criar orçamento",
    },
    {
      feito: temPedido,
      titulo: "Cliente aprovou? Faça o pedido",
      texto: "O orçamento vira pedido para a gráfica produzir, e você acompanha aqui.",
      para: "/parceiro/orcamentos" as const,
      acao: "Ver orçamentos",
    },
  ];

  if (passos.every((p) => p.feito)) return null;
  const proximo = passos.find((p) => !p.feito)!;

  return (
    <section className="rounded-2xl border border-[color:var(--bex-cyan)]/30 bg-[color:var(--bex-cyan)]/5 p-5">
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-[color:var(--bex-cyan)]" />
        <h2 className="font-semibold">Primeiros passos</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {passos.filter((p) => p.feito).length} de {passos.length}
        </span>
      </div>

      <ol className="mt-3 space-y-2">
        {passos.map((p) => (
          <li key={p.titulo} className="flex items-start gap-2.5">
            {p.feito ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-cyan)]" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p className={cn("text-sm font-medium", p.feito && "text-muted-foreground line-through")}>{p.titulo}</p>
              {!p.feito && <p className="text-sm text-muted-foreground">{p.texto}</p>}
            </div>
          </li>
        ))}
      </ol>

      <Link
        to={proximo.para}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--bex-cyan)] px-3 py-2 text-sm font-medium text-[color:var(--primary-foreground)] transition-opacity hover:opacity-90"
      >
        {proximo.acao} <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}
