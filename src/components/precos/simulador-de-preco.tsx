import { useId, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LinhaDePreco } from "@/domain/precos/painel-de-precos";
import {
  centavosParaTexto,
  fraseDoLucro,
  fraseViva,
  motivosDoCustoIncompleto,
  prenderNaReguas,
  prepararSimulador,
  reaisPorExtenso,
  resumoDaBarra,
  ROTULO_DA_FAIXA_DO_SIMULADOR,
  simularNoPreco,
  textoDaMarca,
  textoDeValorDoControle,
  textoParaCentavos,
  zonaDoPreco,
  TEXTO_DO_LUCRO_SOBRE_O_PRECO,
  type CodigoDaFatia,
  type CodigoDaMarca,
  type FaixaDoSimulador,
  type Simulacao,
  type SimuladorPronto,
} from "@/domain/precos/simulador-de-preco";
import {
  alavancasDeLucro,
  filtrarAlavancas,
  fraseDoAltoDoPainel,
  ROTULO_DE_QUEM,
  ROTULO_DO_FILTRO,
  textoDoGanho,
  type FiltroDeAlavancas,
} from "@/domain/precos/alavancas-de-lucro";
import type { FaixaDaMargem } from "@/domain/precos/propostas";
import { COR_DA_FAIXA } from "./proposta-de-preco";

/**
 * O que o simulador precisa do estado da linha. É um pedaço do Estado de useLinha em painel-de-precos.tsx.
 * Declarado aqui para a tela do simulador não importar a lista e formar um ciclo.
 */
export type EstadoDoSimulador = {
  texto: string;
  setTexto: (t: string) => void;
};

/** Cores de texto com contraste de pelo menos 4,5 para 1 no claro e no escuro. O texto sempre vem junto. */
const COR_DO_TEXTO_DA_FAIXA: Record<FaixaDoSimulador, string> = {
  abaixo_do_custo: "text-[#b42318] dark:text-[#ff8a80]",
  abaixo_do_minimo: "text-[#8a5a00] dark:text-[#f5b942]",
  no_minimo: "text-[#146c43] dark:text-[#45d4a0]",
  acima: "text-[#146c43] dark:text-[#45d4a0]",
};
const ICONE_DA_FAIXA: Record<FaixaDoSimulador, typeof CircleAlert> = {
  abaixo_do_custo: TriangleAlert,
  abaixo_do_minimo: CircleAlert,
  no_minimo: CircleCheck,
  acima: CircleCheck,
};
const COR_DO_AVISO = "text-[#8a5a00] dark:text-[#f5b942]";

/**
 * Fatias de custo em matizes diferentes, separadas por 2 px, e cada fatia larga leva o seu número, o mesmo da lista.
 * Vermelho, amarelo e verde ficam só para as zonas e para o lucro e o prejuízo, para não confundir.
 */
export const COR_DA_FATIA: Record<CodigoDaFatia, string> = {
  material: "bg-[#1e3a8a] dark:bg-[#bfdbfe]",
  maquina: "bg-[#0e7490] dark:bg-[#67e8f9]",
  mao_de_obra: "bg-[#7c3aed] dark:bg-[#c4b5fd]",
  rateio: "bg-[#6b7280] dark:bg-[#d1d5db]",
  perdas: "bg-[#a21caf] dark:bg-[#f0abfc]",
  imposto: "bg-[#78350f] dark:bg-[#d6b48a]",
  cartao: "bg-[#0ea5e9] dark:bg-[#7dd3fc]",
  imposto_e_cartao: "bg-[#78350f] dark:bg-[#d6b48a]",
  lucro: COR_DA_FAIXA.acima,
  prejuizo: COR_DA_FAIXA.abaixo,
};

/** Número de bolinha: fundo e texto do tema, para o contraste valer sobre qualquer cor de fatia ou de régua. */
const BOLINHA =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-sm font-bold leading-none text-foreground ring-2 ring-foreground";
/** Mesma bolinha, com número de 16 px, para o painel de alavancas. */
const BOLINHA_GRANDE =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-base font-bold leading-none text-foreground ring-2 ring-foreground";
const ALTURA_DA_BOLINHA = 26;
const NIVEIS_DE_MARCA = 3;
/** Marcas mais perto que isto, em por cento da régua, sobem para outra linha para os números não se sobreporem. */
const PERTO_DEMAIS = 9;

const FAIXA_DA_COR: Record<FaixaDoSimulador, FaixaDaMargem> = {
  abaixo_do_custo: "abaixo",
  abaixo_do_minimo: "perto",
  no_minimo: "acima",
  acima: "acima",
};

export const LEGENDA_DAS_ZONAS: Array<{ faixa: FaixaDaMargem; texto: string }> = [
  { faixa: "abaixo", texto: "Vermelho: abaixo do custo real, cada venda dá prejuízo" },
  { faixa: "perto", texto: "Amarelo: abaixo do mínimo recomendado" },
  { faixa: "acima", texto: "Verde: do mínimo recomendado para cima" },
];

/** O controle ocupa 44 px de altura e o botão de arrastar tem 44 px, o tamanho mínimo para o toque. */
const METADE_DO_BOTAO = 22;

function SeloDeCustoIncompleto({ motivos }: { motivos: string[] }) {
  if (motivos.length === 0) return null;
  return (
    <div data-testid="selo-custo-incompleto" className="space-y-1 text-base">
      <span
        className={cn("inline-flex items-center gap-1.5 font-semibold", COR_DO_AVISO)}
        data-selo="custo-incompleto"
      >
        <CircleAlert className="h-5 w-5 shrink-0" aria-hidden />
        Custo incompleto
      </span>
      <ul className="list-disc space-y-1 pl-6">
        {motivos.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

function Regua({
  linha,
  pronto,
  centavos,
  onChange,
  idDaDica,
  numeros,
}: {
  linha: LinhaDePreco;
  pronto: SimuladorPronto;
  centavos: number;
  onChange: (c: number) => void;
  idDaDica: string;
  /** Número de cada marca que cabe na régua, o mesmo da lista de marcas. */
  numeros: Map<CodigoDaMarca, number>;
}) {
  const { limites } = pronto;
  const largura = limites.maxCentavos - limites.minCentavos;
  const pos = (c: number) =>
    Math.min(100, Math.max(0, ((c - limites.minCentavos) / largura) * 100));
  const fimDoVermelho = pos(pronto.equilibrioCentavos);
  const fimDoAmarelo =
    pronto.minimoCentavos != null && pronto.minimoCentavos > pronto.equilibrioCentavos
      ? pos(pronto.minimoCentavos)
      : fimDoVermelho;
  const zonas: Array<{ faixa: FaixaDaMargem; de: number; ate: number }> = [
    { faixa: "abaixo", de: 0, ate: fimDoVermelho },
    { faixa: "perto", de: fimDoVermelho, ate: fimDoAmarelo },
    { faixa: "acima", de: fimDoAmarelo, ate: 100 },
  ];
  // O controle e as marcas usam o mesmo valor, preso à régua e ao passo, para o valor lido e o texto lido combinarem.
  const noControle = prenderNaReguas(centavos, limites);
  const faixaDoControle = zonaDoPreco(noControle, pronto.equilibrioCentavos, pronto.minimoCentavos);
  const dentro = pronto.marcas.filter((m) => m.dentro).sort((a, b) => a.pos - b.pos);
  const niveis = new Map<CodigoDaMarca, number>();
  let anterior: { pos: number; nivel: number } | null = null;
  for (const m of dentro) {
    const nivel: number =
      anterior != null && m.pos - anterior.pos < PERTO_DEMAIS
        ? (anterior.nivel + 1) % NIVEIS_DE_MARCA
        : 0;
    niveis.set(m.codigo, nivel);
    anterior = { pos: m.pos, nivel };
  }
  const linhasDeNumero = dentro.length === 0 ? 0 : Math.max(...niveis.values()) + 1;
  const alturaDosNumeros = linhasDeNumero * ALTURA_DA_BOLINHA;
  return (
    <div
      className="relative w-full"
      style={{ height: 44 + alturaDosNumeros }}
      data-testid="regua-do-simulador"
    >
      <div
        className="pointer-events-none absolute inset-y-0 flex"
        style={{ left: METADE_DO_BOTAO, right: METADE_DO_BOTAO }}
        aria-hidden
      >
        <div
          className="absolute left-0 right-0 h-3 -translate-y-1/2 overflow-hidden rounded-full"
          style={{ top: alturaDosNumeros + 22 }}
        >
          {zonas
            .filter((z) => z.ate > z.de)
            .map((z) => (
              <div
                key={z.faixa}
                className={cn("absolute inset-y-0", COR_DA_FAIXA[z.faixa])}
                data-zona={z.faixa}
                style={{ left: `${z.de}%`, width: `${z.ate - z.de}%` }}
              />
            ))}
        </div>
        {dentro.map((m) => {
          const nivel = niveis.get(m.codigo) ?? 0;
          return (
            <div
              key={m.codigo}
              className="absolute bottom-3 -translate-x-1/2"
              data-marca={m.codigo}
              style={{ left: `${pos(m.centavos)}%`, top: nivel * ALTURA_DA_BOLINHA }}
            >
              <span className={cn(BOLINHA, "relative z-10")}>{numeros.get(m.codigo)}</span>
              <span className="absolute bottom-0 left-1/2 top-5 w-1 -translate-x-1/2 rounded-sm bg-foreground ring-2 ring-background" />
            </div>
          );
        })}
      </div>
      <SliderPrimitive.Root
        className="absolute inset-x-0 bottom-0 flex h-11 w-full touch-none select-none items-center"
        min={limites.minCentavos}
        max={limites.maxCentavos}
        step={limites.passo}
        value={[noControle]}
        onValueChange={(v) => {
          if (typeof v[0] === "number" && Number.isFinite(v[0])) onChange(v[0]);
        }}
      >
        <SliderPrimitive.Thumb
          aria-label={`Preço simulado de ${linha.nome}, em reais`}
          aria-valuetext={textoDeValorDoControle(noControle, faixaDoControle)}
          aria-describedby={idDaDica}
          data-testid="botao-de-arrastar"
          className="block h-11 w-11 cursor-grab rounded-full border-4 border-foreground bg-background shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring active:cursor-grabbing"
        />
      </SliderPrimitive.Root>
    </div>
  );
}

/** Fatia com pelo menos esta largura, em por cento da barra, mostra o número dentro. As mais finas só na lista. */
const LARGURA_PARA_NUMERO = 9;

function BarraEmpilhada({ s }: { s: Simulacao }) {
  const aviso = s.lucroCentavos < 0;
  return (
    <div data-testid="barra-empilhada" className="space-y-3">
      <div className="relative">
        <div
          className="flex h-10 w-full gap-0.5 overflow-hidden rounded-md bg-card"
          role="img"
          aria-label={resumoDaBarra(s)}
        >
          {s.fatias
            .filter((f) => f.larguraNaBarra > 0)
            .map((f) => (
              <div
                key={f.codigo}
                className={cn("flex h-full items-center justify-center", COR_DA_FATIA[f.codigo])}
                data-fatia={f.codigo}
                style={{ width: `${f.larguraNaBarra}%` }}
              >
                {f.larguraNaBarra >= LARGURA_PARA_NUMERO ? (
                  <span className={BOLINHA} aria-hidden>
                    {s.fatias.indexOf(f) + 1}
                  </span>
                ) : null}
              </div>
            ))}
        </div>
        {aviso ? (
          <div
            className="pointer-events-none absolute -inset-y-1 w-1 -translate-x-1/2 rounded-sm bg-foreground ring-2 ring-background"
            style={{ left: `${s.posicaoDoPrecoNaBarra}%` }}
            data-testid="marca-do-preco-na-barra"
            aria-hidden
          />
        ) : null}
      </div>
      {aviso ? (
        <p className="text-base">
          O preço chega só até o traço marcado na barra. Tudo o que passa dele é prejuízo.
        </p>
      ) : null}
      <ul className="grid gap-2 text-base sm:grid-cols-2" data-testid="legenda-das-fatias">
        {s.fatias.map((f, i) => (
          <li
            key={f.codigo}
            className="flex min-h-11 items-center gap-2"
            data-fatia-legenda={f.codigo}
          >
            <span
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-sm font-bold",
                COR_DA_FATIA[f.codigo],
              )}
              aria-hidden
            >
              <span className={BOLINHA}>{i + 1}</span>
            </span>
            <span>
              <span className="font-semibold">{f.rotulo}.</span>{" "}
              {reaisPorExtenso(Math.abs(f.centavos))},{" "}
              {Math.abs(f.pctDoPreco).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por
              cento
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "O que melhora o lucro": alavancas ordenadas pelo ganho em reais por unidade, no preço que está no simulador.
 * Nada aqui grava. A alavanca de preço só põe o preço no simulador, e quem pede a mudança é o botão Propor que já existe.
 */
function PainelDeAlavancas({
  linha,
  pronto,
  sim,
  podePropor,
  irPara,
}: {
  linha: LinhaDePreco;
  pronto: SimuladorPronto;
  sim: Simulacao;
  podePropor: boolean;
  irPara: (c: number) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroDeAlavancas>("todas");
  const painel = alavancasDeLucro(linha, pronto, sim, { podeVerCusto: true });
  const quemTem = new Set([...painel.prontas, ...painel.semDado].map((a) => a.quem));
  const filtros = (["todas", "gerente", "dono", "producao"] as FiltroDeAlavancas[]).filter(
    (f) => f === "todas" || quemTem.has(f),
  );
  // O preço do simulador muda a lista. Se o grupo escolhido sumiu, ou se os botões nem aparecem mais, volta para Todas.
  const ativo: FiltroDeAlavancas = filtros.length > 2 && filtros.includes(filtro) ? filtro : "todas";
  const prontas = filtrarAlavancas(painel.prontas, ativo);
  const semDado = filtrarAlavancas(painel.semDado, ativo);
  return (
    <div className="space-y-3" data-testid="alavancas-de-lucro">
      <h4 className="font-semibold">O que melhora o lucro</h4>
      <p>{fraseDoAltoDoPainel(painel)}</p>
      <SeloDeCustoIncompleto motivos={painel.custoIncompleto} />
      {painel.custoIncompleto.length > 0 ? (
        <p data-testid="alavancas-custo-incompleto">
          Com o custo incompleto, o lucro verdadeiro é menor do que este painel mostra. Os ganhos em
          reais continuam valendo como conta, mas não são promessa.
        </p>
      ) : null}
      {filtros.length > 2 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar alavancas por quem decide">
          {filtros.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={ativo === f}
              onClick={() => setFiltro(f)}
              data-filtro-de-alavanca={f}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativo === f ? "border-foreground bg-foreground text-background" : "bg-background",
              )}
            >
              {ROTULO_DO_FILTRO[f]}
            </button>
          ))}
        </div>
      ) : null}
      {prontas.length > 0 ? (
        <ol className="space-y-3" data-testid="lista-de-alavancas">
          {prontas.map((a, i) => (
            <li
              key={a.codigo}
              data-alavanca={a.codigo}
              data-ganho-centavos={a.ganhoCentavos}
              className="space-y-1 rounded-lg border border-border bg-background p-3"
            >
              <p className="font-semibold">
                <span className={cn(BOLINHA_GRANDE, "mr-2")} aria-hidden>
                  {i + 1}
                </span>
                {a.titulo}
              </p>
              <p className={cn("font-semibold", COR_DO_TEXTO_DA_FAIXA.acima)}>{textoDoGanho(a)}.</p>
              <p>{a.frase}</p>
              <p>
                <span className="font-semibold">A quem cabe.</span> {ROTULO_DE_QUEM[a.quem]}.
              </p>
              <p className="text-muted-foreground">{a.cautela}</p>
              {a.podePropor && a.precoAlvoCentavos != null && podePropor ? (
                <button
                  type="button"
                  onClick={() => irPara(a.precoAlvoCentavos as number)}
                  className="inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 text-base font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Pôr {reaisPorExtenso(a.precoAlvoCentavos)} no simulador. Depois use Propor este
                  preço
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {ativo === "todas" && painel.somaDoBalcaoCentavos != null ? (
        <p data-testid="soma-das-alavancas">
          <span className="font-semibold">Juntas.</span> Se o preço, a maior ocupação e a perda e
          falha acontecerem todos, o ganho de balcão soma {reaisPorExtenso(painel.somaDoBalcaoCentavos)} por
          unidade. A alavanca do parceiro é outra venda e não entra nessa soma.
        </p>
      ) : null}
      {semDado.length > 0 ? (
        <div className="space-y-1" data-testid="alavancas-sem-dado">
          <h5 className="font-semibold">Sem dado para medir</h5>
          <ul className="space-y-2">
            {semDado.map((a) => (
              <li key={a.codigo} data-alavanca-sem-dado={a.codigo}>
                <span className="font-semibold">{a.titulo}.</span> {a.frase}{" "}
                <span className="text-muted-foreground">{ROTULO_DE_QUEM[a.quem]}.</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Simulador de preço de um produto. Arrastar escreve só no texto de preço da linha, o mesmo do campo digitado.
 * Nada aqui grava preço: o pedido sai pelo botão de propor que a lista passa em `botao`, e o gerente aprova.
 */
export function SimuladorDePreco({
  linha,
  e,
  podePropor,
  botao,
  recado,
}: {
  linha: LinhaDePreco;
  e: EstadoDoSimulador;
  podePropor: boolean;
  /** O botão "Propor este preço", que é o da própria lista e chama o fluxo de proposta que já existe. */
  botao?: ReactNode;
  /** O motivo, o erro e o recado de pedido enviado. */
  recado?: ReactNode;
}) {
  const idDaDica = useId();
  // Último preço digitado que valia. Texto incompleto, como "70,", não derruba a simulação para o preço de hoje.
  const ultimoValido = useRef<number | null>(null);
  const motivos = motivosDoCustoIncompleto(linha.real);
  const pronto = prepararSimulador(linha);

  if (pronto.estado === "sem_dado") {
    return (
      <section
        className="space-y-3 rounded-xl border border-border bg-card p-4 text-base"
        aria-label={`Simulador de preço de ${linha.nome}`}
        data-testid="simulador-de-preco"
        data-estado="sem_dado"
      >
        <SeloDeCustoIncompleto motivos={motivos} />
        <p className="font-semibold" role="status">
          {pronto.frase}
        </p>
        <Link
          to="/custos-producao"
          className="inline-flex min-h-11 items-center underline underline-offset-2"
        >
          Abrir custos fixos e mão de obra
        </Link>
      </section>
    );
  }

  const digitado = textoParaCentavos(e.texto);
  if (digitado != null) ultimoValido.current = digitado;
  const preco =
    digitado ?? ultimoValido.current ?? pronto.precoDeHojeCentavos ?? pronto.limites.minCentavos;
  const campoInvalido = digitado == null;
  const numeros = new Map<CodigoDaMarca, number>();
  pronto.marcas
    .filter((m) => m.dentro)
    .forEach((m, i) => {
      numeros.set(m.codigo, i + 1);
    });
  const sim = simularNoPreco(pronto, preco);
  if (sim.estado === "sem_dado") {
    return (
      <section
        className="space-y-3 rounded-xl border border-border bg-card p-4 text-base"
        aria-label={`Simulador de preço de ${linha.nome}`}
        data-testid="simulador-de-preco"
        data-estado="sem_dado"
      >
        <p className="font-semibold" role="status">
          {sim.frase}
        </p>
      </section>
    );
  }
  const Icone = ICONE_DA_FAIXA[sim.faixa];
  const nesteLucro =
    sim.lucroCentavos < 0 ? COR_DO_TEXTO_DA_FAIXA.abaixo_do_custo : COR_DO_TEXTO_DA_FAIXA.acima;
  const irPara = (c: number) => e.setTexto(centavosParaTexto(c));

  return (
    <section
      className="space-y-5 rounded-xl border border-border bg-card p-4 text-base"
      aria-label={`Simulador de preço de ${linha.nome}`}
      data-testid="simulador-de-preco"
      data-estado="ok"
      data-faixa-do-simulador={sim.faixa}
    >
      <SeloDeCustoIncompleto motivos={motivos} />

      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="font-medium">Preço simulado, em reais</span>
          <div className="relative mt-1 w-44">
            <span
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-muted-foreground"
              aria-hidden
            >
              R$
            </span>
            <Input
              value={e.texto}
              onChange={(ev) => e.setTexto(ev.target.value)}
              inputMode="decimal"
              autoComplete="off"
              aria-label={`Preço simulado de ${linha.nome}, digitado, em reais`}
              aria-invalid={campoInvalido}
              aria-describedby={campoInvalido ? `${idDaDica}-invalido` : undefined}
              data-testid="campo-do-simulador"
              className="h-11 pl-10 text-base md:text-base"
            />
          </div>
        </label>
        <p
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 font-semibold",
            COR_DO_TEXTO_DA_FAIXA[sim.faixa],
          )}
          data-testid="zona-atual"
          data-faixa={sim.faixa}
        >
          <Icone className="h-5 w-5 shrink-0" aria-hidden />
          {ROTULO_DA_FAIXA_DO_SIMULADOR[sim.faixa]}
        </p>
      </div>
      {campoInvalido ? (
        <p
          id={`${idDaDica}-invalido`}
          className={cn("font-semibold", COR_DO_AVISO)}
          data-testid="campo-invalido"
        >
          Digite um valor como 70,45, com no máximo duas casas depois da vírgula. Enquanto isso a
          simulação fica em {reaisPorExtenso(preco)}.
        </p>
      ) : null}

      <div className="space-y-2">
        <Regua
          linha={linha}
          pronto={pronto}
          centavos={preco}
          onChange={irPara}
          idDaDica={idDaDica}
          numeros={numeros}
        />
        <p id={idDaDica} className="text-base">
          A régua vai de {reaisPorExtenso(pronto.limites.minCentavos)}, perto do custo real, até{" "}
          {reaisPorExtenso(pronto.limites.maxCentavos)}. Use as setas para mudar R$ 0,10 e Page Up
          ou Page Down para mudar R$ 1,00.
        </p>
        <ul className="grid gap-1 text-base sm:grid-cols-3" data-testid="legenda-das-zonas">
          {LEGENDA_DAS_ZONAS.map((z) => (
            <li key={z.faixa} className="flex items-start gap-2">
              <span
                className={cn("mt-1 h-4 w-4 shrink-0 rounded-sm", COR_DA_FAIXA[z.faixa])}
                aria-hidden
              />
              {z.texto}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1">
        <h4 className="font-semibold">Marcas da régua</h4>
        <ul className="flex flex-wrap gap-2" data-testid="lista-de-marcas">
          {pronto.marcas.map((m) => (
            <li key={m.codigo} data-marca-lista={m.codigo}>
              {m.dentro ? (
                <button
                  type="button"
                  onClick={() => irPara(m.centavos)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-left text-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={BOLINHA} aria-hidden>
                    {numeros.get(m.codigo)}
                  </span>
                  {textoDaMarca(m, pronto.limites)}
                </button>
              ) : (
                <span className="inline-flex min-h-11 items-center px-1 text-base">
                  {textoDaMarca(m, pronto.limites)}
                </span>
              )}
            </li>
          ))}
          {linha.menor_concorrente == null ? (
            <li
              className="inline-flex min-h-11 items-center px-1"
              data-marca-lista="sem_concorrente"
            >
              Sem concorrente anotado
            </li>
          ) : null}
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="font-semibold">Para onde vai cada real do preço</h4>
        <BarraEmpilhada s={sim} />
      </div>

      <div className="space-y-2" data-testid="lucro-do-simulador">
        <p
          className={cn("text-lg font-semibold", nesteLucro)}
          data-lucro-centavos={sim.lucroCentavos}
          aria-live="polite"
          aria-atomic="true"
        >
          {fraseDoLucro(sim)}
        </p>
        <p>
          Preço de {sim.vezesOCusto.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vezes o
          custo real.
        </p>
        <p data-testid="frase-viva">{fraseViva(pronto, sim)}</p>
        <p className="text-muted-foreground">{TEXTO_DO_LUCRO_SOBRE_O_PRECO}</p>
      </div>

      <PainelDeAlavancas
        linha={linha}
        pronto={pronto}
        sim={sim}
        podePropor={podePropor}
        irPara={irPara}
      />

      {pronto.avisos.length > 0 ? (
        <ul className="space-y-1" data-testid="avisos-do-simulador">
          {pronto.avisos.map((a) => (
            <li key={a.codigo} data-aviso-simulador={a.codigo} className="flex items-start gap-2">
              <CircleAlert className={cn("mt-0.5 h-5 w-5 shrink-0", COR_DO_AVISO)} aria-hidden />
              {a.frase}
            </li>
          ))}
        </ul>
      ) : null}

      {podePropor ? (
        <div className="space-y-2">
          {sim.faixa === "abaixo_do_custo" ? (
            <p className="font-semibold" role="note">
              Este preço fica abaixo do custo real. O pedido vai para preços pendentes. O gerente só
              consegue aprovar se o preço estiver no piso do cadastro ou acima dele.
            </p>
          ) : null}
          <p>Arrastar não grava o preço. O pedido só vale depois que o gerente aprovar.</p>
          <div>{botao}</div>
        </div>
      ) : (
        <p>Só administrador e gerente pedem mudança de preço. Aqui você só simula.</p>
      )}
      {recado}
    </section>
  );
}
