import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmarAcao } from "@/components/bex/ConfirmarAcao";
import {
  barrasDaProposta,
  explicacaoDaBarra,
  ROTULO_DA_FAIXA,
  type BarraDaProposta,
  type FaixaDaMargem,
  type PropostaDePreco,
} from "@/domain/precos/propostas";
import { brl } from "./tipos";

/** Cores com contraste de pelo menos 4,5 para 1 contra o fundo do cartão, no claro e no escuro. */
export const COR_DA_FAIXA: Record<FaixaDaMargem, string> = {
  abaixo: "bg-[#b42318] dark:bg-[#ff8a80]",
  perto: "bg-[#8a5a00] dark:bg-[#f5b942]",
  acima: "bg-[#146c43] dark:bg-[#45d4a0]",
  sem_dado: "bg-[#4b5563] dark:bg-[#9ca3af]",
};
export const COR_DO_PISO = "bg-[#1d4ed8] dark:bg-[#93c5fd]";

export const LEGENDA_DAS_FAIXAS: Array<{ faixa: FaixaDaMargem; texto: string }> = [
  { faixa: "abaixo", texto: "Vermelho: margem abaixo do mínimo do produto" },
  { faixa: "perto", texto: "Amarelo: margem menos de cinco pontos acima do mínimo" },
  { faixa: "acima", texto: "Verde: margem cinco pontos ou mais acima do mínimo. A cor não garante o preço certo. Confira o preço mínimo recomendado em Preços por produto antes de aprovar." },
];

const pontos = (v: number | null) => (v == null ? "sem custo" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por cento`);

function Explicacao({ barra, proposta }: { barra: BarraDaProposta; proposta: PropostaDePreco }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Explicar: ${barra.rotulo}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp className="h-5 w-5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[90vw] text-base leading-relaxed" role="note">
        {explicacaoDaBarra(barra.tipo, proposta)}
      </PopoverContent>
    </Popover>
  );
}

export function BarrasDaProposta({ proposta }: { proposta: PropostaDePreco }) {
  const barras = barrasDaProposta(proposta);
  return (
    <div className="space-y-2" data-testid="barras-da-proposta">
      {barras.map((b) => {
        const cor = b.tipo === "piso" ? COR_DO_PISO : COR_DA_FAIXA[b.faixa];
        return (
          <div key={b.tipo} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-base">
                <span className="font-medium">{b.rotulo}</span>
                <span>
                  {pontos(b.valor)}
                  {b.tipo !== "piso" ? `, ${ROTULO_DA_FAIXA[b.faixa].toLowerCase()}` : ""}
                </span>
              </div>
              <div
                className="mt-1 h-4 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${b.rotulo}: ${pontos(b.valor)}`}
              >
                <div className={`h-full rounded-full ${cor}`} style={{ width: `${b.largura}%` }} />
              </div>
            </div>
            <Explicacao barra={b} proposta={proposta} />
          </div>
        );
      })}
    </div>
  );
}

export function PropostaDePrecoCartao({
  proposta,
  podeDecidir,
  ocupado,
  aoAprovar,
  aoRecusar,
}: {
  proposta: PropostaDePreco;
  podeDecidir: boolean;
  ocupado: boolean;
  aoAprovar: (id: string) => void;
  aoRecusar: (id: string, nota: string) => void;
}) {
  const [nota, setNota] = useState("");
  const unidade = proposta.unidade ? ` por ${proposta.unidade}` : "";
  const notaOk = nota.trim().length >= 3;
  return (
    <Card data-testid="proposta-de-preco">
      <CardContent className="space-y-4 p-4 text-base">
        <div>
          <h2 className="text-lg font-semibold">{proposta.produto_nome}</h2>
          <p className="mt-1">{proposta.motivo}</p>
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Preço de hoje{unidade}</dt>
            <dd className="font-semibold">{brl(proposta.preco_atual)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Preço proposto{unidade}</dt>
            <dd className="font-semibold">{brl(proposta.preco_proposto)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Piso desta proposta</dt>
            <dd className="font-semibold">{brl(proposta.piso)}</dd>
          </div>
        </dl>
        <BarrasDaProposta proposta={proposta} />
        {podeDecidir ? (
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap gap-3">
              <ConfirmarAcao
                grande
                titulo="Aprovar este preço?"
                descricao={`O preço de ${proposta.produto_nome} passa de ${brl(proposta.preco_atual)} para ${brl(proposta.preco_proposto)}. Orçamentos que já existem não mudam.`}
                rotuloConfirmar="Aprovar preço"
                aoConfirmar={() => aoAprovar(proposta.id)}
              >
                <Button type="button" className="h-11 min-h-11 px-6 text-base" disabled={ocupado}>
                  Aprovar
                </Button>
              </ConfirmarAcao>
              <ConfirmarAcao
                grande
                destrutivo
                titulo="Recusar este preço?"
                descricao={`O preço de ${proposta.produto_nome} continua em ${brl(proposta.preco_atual)}. O motivo fica guardado: ${nota.trim()}`}
                rotuloConfirmar="Recusar preço"
                aoConfirmar={() => aoRecusar(proposta.id, nota.trim())}
              >
                <Button type="button" variant="outline" className="h-11 min-h-11 px-6 text-base" disabled={ocupado || !notaOk}>
                  Recusar
                </Button>
              </ConfirmarAcao>
            </div>
            <label className="block text-base">
              <span className="mb-1 block">Motivo para recusar, obrigatório, com pelo menos 3 letras. Escreva o motivo para liberar o botão Recusar.</span>
              <Input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={500}
                placeholder="Escreva por que não vale"
                className="h-11 text-base md:text-base"
              />
            </label>
          </div>
        ) : (
          <p className="border-t pt-3 text-base text-muted-foreground">Só administrador ou gerente aprova ou recusa preço.</p>
        )}
      </CardContent>
    </Card>
  );
}
