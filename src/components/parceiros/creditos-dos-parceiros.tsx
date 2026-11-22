import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { StatusChip } from "@/components/bex/StatusChip";
import { cn } from "@/lib/utils";
import {
  dataCompleta,
  diaDoAviso,
  diaMes,
  frasePrazo,
  queOLancamentoPaga,
  reais,
  rotuloDoTipo,
  type LinhaDoLivro,
  type ParceiroCalculado,
  type ProgramaDeCredito,
  type Resumo,
  type SituacaoDoCredito,
} from "@/domain/parceiros/creditos-painel";

/**
 * As peças da tela de créditos dos parceiros (22/11/2026): o resumo, o que vence e a lista de parceiros com o livro de cada
 * um. Só desenha: todas as contas são de `src/domain/parceiros/creditos-painel.ts` e o banco entrega o saldo.
 */

const ROTULO_DA_SITUACAO: Record<SituacaoDoCredito, string> = {
  a_vencer: "A vencer",
  em_uso: "Em uso",
  usado: "Usado",
  vencido: "Vencido",
  sem_vencimento: "Sem vencimento",
};

function tomDaSituacao(s: SituacaoDoCredito, dias: number | null, limite: number): "cyan" | "amber" | "lime" | "magenta" | "muted" {
  if (s === "usado") return "lime";
  if (s === "vencido") return "magenta";
  if (s === "sem_vencimento") return "muted";
  return dias != null && dias <= limite ? "amber" : "cyan";
}

function Ficha({ id, titulo, valor, detalhe }: { id: string; titulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid={id}>
      <dt className="text-sm text-muted-foreground">{titulo}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{valor}</dd>
      <dd className="mt-0.5 text-sm text-muted-foreground">{detalhe}</dd>
    </div>
  );
}

export function ResumoDosCreditos({ resumo }: { resumo: Resumo }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="resumo-dos-creditos">
      <Ficha
        id="ficha-saldo"
        titulo="Saldo disponível"
        valor={reais(resumo.saldoTotal)}
        detalhe={`${resumo.parceirosComSaldo} ${resumo.parceirosComSaldo === 1 ? "parceiro com saldo" : "parceiros com saldo"}`}
      />
      <Ficha id="ficha-concedido" titulo="Já concedido" valor={reais(resumo.concedido)} detalhe="Soma de todos os créditos lançados" />
      <Ficha
        id="ficha-usado"
        titulo="Já pagou pedidos"
        valor={reais(resumo.usado)}
        detalhe={resumo.pedidosPagos === 0 ? "Nenhum pedido pago com crédito ainda" : `${resumo.pedidosPagos} ${resumo.pedidosPagos === 1 ? "pedido" : "pedidos"}`}
      />
      <Ficha id="ficha-vencido" titulo="Venceu sem uso" valor={reais(resumo.vencidoSemUso)} detalhe={resumo.vencidoSemUso > 0 ? "Crédito que já não vale mais" : "Nada venceu ainda"} />
    </dl>
  );
}

export function VencimentosDosCreditos({ resumo, programa }: { resumo: Resumo; programa: ProgramaDeCredito | null }) {
  const dias = programa?.lembreteDias ?? 7;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="titulo-vencimentos" data-testid="vencimentos-dos-creditos">
      <h2 id="titulo-vencimentos" className="font-semibold">
        O que vence
      </h2>
      {resumo.vencimentos.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground" data-testid="sem-vencimentos">
          Nenhum crédito com vencimento pela frente.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {resumo.vencimentos.map((v) => (
            <li key={v.chave} className="py-3" data-testid={`vencimento-${v.chave}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-base">
                  <span className="text-xl font-bold tabular-nums">{v.dia}</span> <span className="text-muted-foreground">· {frasePrazo(v.dias)}</span>
                </p>
                <p className="text-base">
                  <span className="font-bold tabular-nums">{reais(v.valor)}</span>{" "}
                  <span className="text-muted-foreground">
                    de {v.parceiros} {v.parceiros === 1 ? "parceiro" : "parceiros"}
                  </span>
                </p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {programa?.lembreteAtivo === false
                  ? "O aviso automático aos responsáveis está desligado."
                  : v.dias <= dias
                    ? `O aviso aos responsáveis já está valendo (${dias} dias antes, de segunda a sábado).`
                    : `O aviso aos responsáveis começa em ${diaDoAviso(v.chave, dias)} (${dias} dias antes, de segunda a sábado).`}
              </p>
              <p className="mt-1 text-sm">{v.nomes.join(", ")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LinhaDoLancamento({ l, programa }: { l: LinhaDoLivro; programa: ProgramaDeCredito | null }) {
  const lan = l.lancamento;
  const entra = lan.valor > 0;
  const limite = programa?.lembreteDias ?? 7;
  return (
    <li className="space-y-1 py-3" data-testid="lancamento" data-natureza={l.natureza}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="font-medium">{rotuloDoTipo(lan.tipo)}</span>
          <span className="text-muted-foreground"> · {dataCompleta(lan.criadoEm)}</span>
          {lan.descricao ? <span className="text-muted-foreground"> · {lan.descricao}</span> : null}
        </p>
        <p className={cn("text-base font-bold tabular-nums", !entra && "text-destructive")} data-testid="valor-do-lancamento">
          {entra ? "+" : "−"} {reais(Math.abs(lan.valor))}
        </p>
      </div>
      {l.natureza === "credito" && l.situacao && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusChip label={ROTULO_DA_SITUACAO[l.situacao]} tone={tomDaSituacao(l.situacao, l.dias, limite)} compacto />
          {lan.expiraEm ? (
            <span className="text-muted-foreground">
              {l.situacao === "vencido" ? `Venceu em ${dataCompleta(lan.expiraEm)}` : `Vence em ${dataCompleta(lan.expiraEm)}${l.dias != null && l.situacao !== "usado" ? ` (${frasePrazo(l.dias).replace("vence ", "")})` : ""}`}
            </span>
          ) : null}
        </div>
      )}
      <p className="text-sm" data-testid="o-que-paga">
        <span className="font-medium">O que paga: </span>
        {queOLancamentoPaga(l, programa)}
      </p>
      {lan.criadoPorNome ? <p className="text-xs text-muted-foreground">Lançado por {lan.criadoPorNome}</p> : null}
    </li>
  );
}

function CartaoDoParceiro({ p, programa }: { p: ParceiroCalculado; programa: ProgramaDeCredito | null }) {
  const [aberto, setAberto] = useState(false);
  const corpo = `credito-${p.parceiroId}`;
  const limite = programa?.lembreteDias ?? 7;
  return (
    <li className="rounded-xl border border-border bg-card" data-testid={`parceiro-${p.parceiroId}`}>
      <button
        type="button"
        className="flex min-h-11 w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={aberto}
        aria-controls={corpo}
        onClick={() => setAberto((a) => !a)}
        data-testid={`abrir-${p.parceiroId}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{p.nome}</span>
          <span className="block text-sm text-muted-foreground">
            {p.responsavelNome ?? "Sem responsável"}
            {p.status && p.status !== "ativo" ? ` · parceiro ${p.status}` : ""}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-lg font-bold tabular-nums" data-testid="saldo-do-parceiro">
            {reais(p.saldo)}
          </span>
          <span className="block text-sm text-muted-foreground" data-testid="vencimento-do-parceiro">
            {p.venceEm && p.diasParaVencer != null ? `${diaMes(p.venceEm)} · ${frasePrazo(p.diasParaVencer).replace("vence ", "")}` : p.livro.vencidoSemUso > 0 ? "com crédito vencido" : "sem vencimento"}
          </span>
        </span>
        {p.venceEm && p.diasParaVencer != null && p.diasParaVencer <= limite ? <StatusChip label="Vence logo" tone="amber" compacto /> : null}
        <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", aberto && "rotate-180")} aria-hidden="true" />
      </button>
      {aberto && (
        <div id={corpo} className="border-t border-border px-4 pb-2" data-testid={`livro-${p.parceiroId}`}>
          {!p.confere && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-[color:var(--warning)] px-3 py-2 text-sm" data-testid="saldo-nao-confere">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                O saldo do banco ({reais(p.saldo)}) não bate com a soma do livro ({reais(p.livro.vivo)}). Vale o do banco; confira os lançamentos.
              </span>
            </p>
          )}
          {p.livro.semCredito > 0 && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-[color:var(--warning)] px-3 py-2 text-sm" data-testid="uso-sem-credito">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Há uso de crédito maior do que os créditos que valiam na data ({reais(p.livro.semCredito)}). Confira com a gerência.</span>
            </p>
          )}
          <ul className="divide-y divide-border">
            {p.livro.linhas.map((l) => (
              <LinhaDoLancamento key={l.lancamento.id} l={l} programa={programa} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function ListaDeCreditos({ parceiros, programa }: { parceiros: ParceiroCalculado[]; programa: ProgramaDeCredito | null }) {
  if (parceiros.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="lista-vazia">
        Nenhum parceiro com esses filtros.
      </p>
    );
  }
  return (
    <ul className="space-y-2" data-testid="lista-de-creditos">
      {parceiros.map((p) => (
        <CartaoDoParceiro key={p.parceiroId} p={p} programa={programa} />
      ))}
    </ul>
  );
}
