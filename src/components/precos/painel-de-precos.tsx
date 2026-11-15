import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  PackageX,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  frasesDaMargem,
  lerReais,
  previaDoPreco,
  ROTULO_DA_SITUACAO,
  type Avaliacao,
  type LinhaDePreco,
  type Situacao,
} from "@/domain/precos/painel-de-precos";
import { ROTULO_DA_FAIXA, type FaixaDaMargem } from "@/domain/precos/propostas";
import { COR_DA_FAIXA } from "./proposta-de-preco";

export const reais = (n: number | null | undefined) =>
  n == null
    ? "Sem valor"
    : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const UNIDADE: Record<string, string> = {
  m2: "metro quadrado",
  "m²": "metro quadrado",
  un: "unidade",
  m: "metro",
  kg: "quilo",
  h: "hora",
  cm: "centímetro",
};
export const unidadePorExtenso = (u: string) => UNIDADE[u.toLowerCase()] ?? u;

export const TEXTO_DO_PISO =
  "O piso é o menor preço que ainda deixa a margem mínima do produto. Abaixo dele a casa vende com lucro menor do que aceitou.";
export const TEXTO_DA_MARGEM =
  "Margem é a parte do preço que sobra depois de pagar o custo. A barra vai de zero a cem por cento e o risco marca o mínimo.";

/** Cores com contraste de pelo menos 4,5 para 1 no claro e no escuro. */
export const COR_DO_TEXTO: Record<Situacao, string> = {
  abaixo: "text-[#b42318] dark:text-[#ff8a80]",
  sem_custo: "text-[#4b5563] dark:text-[#d1d5db]",
  sem_preco: "text-[#4b5563] dark:text-[#d1d5db]",
  justa: "text-[#8a5a00] dark:text-[#f5b942]",
  boa: "text-[#146c43] dark:text-[#45d4a0]",
};
const ICONE: Record<Situacao, typeof CircleAlert> = {
  abaixo: TriangleAlert,
  sem_custo: PackageX,
  sem_preco: CircleMinus,
  justa: CircleAlert,
  boa: CircleCheck,
};
const COR_DO_PISO_TEXTO = "text-[#1d4ed8] dark:text-[#93c5fd]";

export function Ajuda({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Explicar: ${rotulo}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp className="h-5 w-5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[90vw] text-base leading-relaxed" role="note">
        {texto}
      </PopoverContent>
    </Popover>
  );
}

export function SeloDaSituacao({ situacao }: { situacao: Situacao }) {
  const Icone = ICONE[situacao];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-base font-semibold",
        COR_DO_TEXTO[situacao],
      )}
      data-situacao={situacao}
    >
      <Icone className="h-5 w-5 shrink-0" aria-hidden />
      {ROTULO_DA_SITUACAO[situacao]}
    </span>
  );
}

const FAIXA_DA_SITUACAO: Record<Situacao, FaixaDaMargem> = {
  abaixo: "abaixo",
  justa: "perto",
  boa: "acima",
  sem_custo: "sem_dado",
  sem_preco: "sem_dado",
};

/** Barra de zero a cem por cento, com o risco do mínimo e a frase escrita por baixo. */
export function MargemEmBarra({
  avaliacao,
  minima,
}: {
  avaliacao: Avaliacao;
  minima: number | null;
}) {
  const largura = avaliacao.margem == null ? 0 : Math.max(0, Math.min(100, avaliacao.margem));
  const frase = frasesDaMargem(avaliacao, minima);
  return (
    <div className="min-w-44" data-testid="margem-em-barra">
      <div
        className="relative h-4 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={frase}
      >
        <div
          className={cn("h-full rounded-full", COR_DA_FAIXA[FAIXA_DA_SITUACAO[avaliacao.situacao]])}
          style={{ width: `${largura}%` }}
        />
        {minima != null ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground"
            style={{ left: `${Math.min(100, Math.max(0, minima))}%` }}
            aria-hidden
          />
        ) : null}
      </div>
      <p className={cn("mt-1 text-base leading-snug", COR_DO_TEXTO[avaliacao.situacao])}>{frase}</p>
    </div>
  );
}

export type PedirPreco = (v: { produtoId: string; preco: number; motivo: string }) => Promise<void>;

/** O estado de uma linha: o que foi digitado, o motivo e o envio. Compartilhado entre tabela e cartão. */
function useLinha(linha: LinhaDePreco, propor: PedirPreco) {
  const inicial = linha.preco != null ? linha.preco.toFixed(2).replace(".", ",") : "";
  const [texto, setTexto] = useState(inicial);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const previa = previaDoPreco(linha, texto);
  const motivoOk = !previa.exigeMotivo || motivo.trim().length >= 3;
  const digitou = texto !== inicial;

  async function enviar() {
    const valor = lerReais(texto);
    if (valor == null) return;
    setEnviando(true);
    setErro(null);
    try {
      await propor({ produtoId: linha.id, preco: valor, motivo: motivo.trim() });
      setEnviada(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para enviar o pedido.");
    } finally {
      setEnviando(false);
    }
  }
  return {
    texto,
    setTexto: (t: string) => {
      setTexto(t);
      setEnviada(false);
      setErro(null);
    },
    motivo,
    setMotivo,
    enviando,
    enviada,
    erro,
    previa,
    digitou,
    motivoOk,
    podeEnviar: previa.podePedir && motivoOk && !enviando && !enviada,
    enviar,
  };
}
type Estado = ReturnType<typeof useLinha>;

function CampoDePreco({
  linha,
  e,
  podePropor,
}: {
  linha: LinhaDePreco;
  e: Estado;
  podePropor: boolean;
}) {
  return (
    <div className="relative w-40">
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
        disabled={!podePropor}
        aria-label={`Preço do balcão de ${linha.nome}, em reais`}
        aria-invalid={e.previa.avaliacao.situacao === "abaixo" && e.digitou}
        className="h-11 pl-10 text-base md:text-base"
      />
    </div>
  );
}

function BotaoPropor({ e }: { e: Estado }) {
  const rotulo = e.previa.exigeMotivo ? "Propor preço com motivo" : "Propor preço";
  return (
    <Button
      type="button"
      className="h-11 min-h-11 text-base"
      disabled={!e.podeEnviar}
      onClick={() => void e.enviar()}
    >
      {e.enviando ? "Enviando" : rotulo}
    </Button>
  );
}

function Enviada() {
  return (
    <p className={cn("font-semibold", COR_DO_TEXTO.boa)} role="status">
      Proposta criada.{" "}
      <Link
        to="/precos-pendentes"
        className="inline-flex min-h-11 items-center underline underline-offset-2"
      >
        Ver em preços pendentes
      </Link>
    </p>
  );
}

function Previa({ linha, e }: { linha: LinhaDePreco; e: Estado }) {
  const p = e.previa;
  const parceiro = linha.preco_parceiro;
  const ruim = p.avaliacao.situacao === "abaixo" || p.avaliacao.parceiroAcima;
  return (
    <div className="space-y-2 text-base" data-testid="previa-do-preco">
      {e.digitou ? (
        <p>
          <span className={cn("font-semibold", COR_DO_PISO_TEXTO)}>Piso {reais(p.piso)}.</span>{" "}
          {p.margem != null
            ? `Margem nova ${p.margem.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por cento.`
            : "Sem margem para mostrar."}
          {parceiro != null ? ` Parceiro continua em ${reais(parceiro)}.` : ""}
        </p>
      ) : null}
      {p.aviso ? (
        <p className={cn("font-semibold", ruim && COR_DO_TEXTO.abaixo)} role="alert">
          {p.aviso}
        </p>
      ) : null}
      {p.exigeMotivo ? (
        <label className="block">
          <span className="font-medium">Motivo do pedido, obrigatório abaixo do piso</span>
          <Input
            value={e.motivo}
            onChange={(ev) => e.setMotivo(ev.target.value)}
            maxLength={500}
            className="mt-1 h-11 text-base md:text-base"
          />
        </label>
      ) : null}
      {e.erro ? (
        <p className={cn("font-semibold", COR_DO_TEXTO.abaixo)} role="alert">
          {e.erro}
        </p>
      ) : null}
      {e.enviada ? <Enviada /> : null}
    </div>
  );
}

function ParceiroTexto({ linha, avaliacao }: { linha: LinhaDePreco; avaliacao: Avaliacao }) {
  if (linha.preco_parceiro == null)
    return <span className="text-muted-foreground">Sem preço de parceiro</span>;
  return (
    <div>
      <div>{reais(linha.preco_parceiro)}</div>
      {avaliacao.parceiroAcima ? (
        <div className={cn("font-semibold", COR_DO_TEXTO.abaixo)}>Maior que o balcão</div>
      ) : null}
    </div>
  );
}

function CustoTexto({ linha }: { linha: LinhaDePreco }) {
  return (
    <div>
      <div>
        <span className="text-muted-foreground">Material </span>
        {linha.custo != null && linha.custo > 0 ? reais(linha.custo) : "Sem custo"}
      </div>
      {linha.custo_cheio != null && linha.custo_cheio > 0 ? (
        <div>
          <span className="text-muted-foreground">Cheio </span>
          {reais(linha.custo_cheio)}
        </div>
      ) : null}
    </div>
  );
}

function LinhaDaTabela({
  linha,
  propor,
  podePropor,
}: {
  linha: LinhaDePreco;
  propor: PedirPreco;
  podePropor: boolean;
}) {
  const e = useLinha(linha, propor);
  const a = e.previa.avaliacao;
  const comRecado = e.digitou || e.enviada || e.erro != null;
  return (
    <>
      <TableRow
        className={cn("h-14 align-top text-base", a.situacao === "abaixo" && "bg-destructive/5")}
        data-testid="linha-de-preco"
      >
        <TableCell className="min-w-48 px-3 text-base">
          <div className="font-semibold">{linha.nome}</div>
          <div className="text-muted-foreground">{linha.familia ?? "Sem família"}</div>
        </TableCell>
        <TableCell className="px-3 text-base">{unidadePorExtenso(linha.unidade)}</TableCell>
        <TableCell className="px-3 text-base">
          <CustoTexto linha={linha} />
        </TableCell>
        <TableCell className={cn("px-3 text-base font-semibold", COR_DO_PISO_TEXTO)}>
          {reais(e.previa.piso)}
        </TableCell>
        <TableCell className="px-3 text-base">
          <CampoDePreco linha={linha} e={e} podePropor={podePropor} />
        </TableCell>
        <TableCell className="px-3 text-base">
          <MargemEmBarra avaliacao={a} minima={linha.margem_minima} />
        </TableCell>
        <TableCell className="px-3 text-base">
          <ParceiroTexto linha={linha} avaliacao={a} />
        </TableCell>
        <TableCell className="px-3 text-base">
          <SeloDaSituacao situacao={a.situacao} />
        </TableCell>
        <TableCell className="px-3 text-base">
          {podePropor ? <BotaoPropor e={e} /> : null}
        </TableCell>
      </TableRow>
      {comRecado ? (
        <TableRow className="text-base">
          <TableCell colSpan={9} className="px-3 text-base">
            <Previa linha={linha} e={e} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function CartaoDePreco({
  linha,
  propor,
  podePropor,
}: {
  linha: LinhaDePreco;
  propor: PedirPreco;
  podePropor: boolean;
}) {
  const e = useLinha(linha, propor);
  const a = e.previa.avaliacao;
  return (
    <article
      className={cn(
        "space-y-3 rounded-xl border bg-card p-4 text-base",
        a.situacao === "abaixo" ? "border-[#b42318] dark:border-[#ff8a80]" : "border-border",
      )}
      data-testid="cartao-de-preco"
    >
      <header>
        <h3 className="text-base font-semibold leading-snug">{linha.nome}</h3>
        <p className="text-muted-foreground">
          {linha.familia ?? "Sem família"}, por {unidadePorExtenso(linha.unidade)}
        </p>
        <div className="mt-1">
          <SeloDaSituacao situacao={a.situacao} />
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <dt className="text-muted-foreground">Custo</dt>
          <dd>
            <CustoTexto linha={linha} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Piso</dt>
          <dd className={cn("font-semibold", COR_DO_PISO_TEXTO)}>{reais(e.previa.piso)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground">Parceiro</dt>
          <dd>
            <ParceiroTexto linha={linha} avaliacao={a} />
          </dd>
        </div>
      </dl>
      <div>
        <div className="mb-1 text-muted-foreground">Preço do balcão</div>
        <CampoDePreco linha={linha} e={e} podePropor={podePropor} />
      </div>
      <MargemEmBarra avaliacao={a} minima={linha.margem_minima} />
      {e.digitou || e.enviada || e.erro != null ? <Previa linha={linha} e={e} /> : null}
      {podePropor ? <BotaoPropor e={e} /> : null}
    </article>
  );
}

export const LEGENDA_DAS_SITUACOES: Array<{ faixa: FaixaDaMargem; texto: string }> = [
  {
    faixa: "abaixo",
    texto: `Vermelho: ${ROTULO_DA_FAIXA.abaixo.toLowerCase()}, o preço está errado`,
  },
  { faixa: "perto", texto: "Amarelo: margem justa, perto do piso" },
  { faixa: "acima", texto: "Verde: margem boa, acima do piso" },
];

const CABECA = "px-3 text-base normal-case tracking-normal text-foreground";

export function ListaDePrecos({
  linhas,
  propor,
  podePropor,
}: {
  linhas: LinhaDePreco[];
  propor: PedirPreco;
  podePropor: boolean;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card sm:block">
        <Table className="text-base">
          <TableHeader>
            <TableRow>
              <TableHead className={CABECA}>Produto</TableHead>
              <TableHead className={CABECA}>Unidade</TableHead>
              <TableHead className={CABECA}>Custo</TableHead>
              <TableHead className={CABECA}>
                <span className="inline-flex items-center">
                  Piso
                  <Ajuda rotulo="piso" texto={TEXTO_DO_PISO} />
                </span>
              </TableHead>
              <TableHead className={CABECA}>Preço do balcão</TableHead>
              <TableHead className={CABECA}>
                <span className="inline-flex items-center">
                  Margem
                  <Ajuda rotulo="margem" texto={TEXTO_DA_MARGEM} />
                </span>
              </TableHead>
              <TableHead className={CABECA}>Parceiro</TableHead>
              <TableHead className={CABECA}>Situação</TableHead>
              <TableHead className={CABECA}>Pedido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <LinhaDaTabela key={l.id} linha={l} propor={propor} podePropor={podePropor} />
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 sm:hidden">
        {linhas.map((l) => (
          <CartaoDePreco key={l.id} linha={l} propor={propor} podePropor={podePropor} />
        ))}
      </div>
    </>
  );
}
