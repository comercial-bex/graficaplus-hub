import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { mensagemErro } from "@/lib/erros";
import {
  FRASE_DO_MOTIVO,
  conferirContasPagas,
  linhasSuspeitasDoExtrato,
  somaDosValores,
  type ContaPagaParaConferir,
  type LinhaDoExtrato,
} from "@/domain/financeiro/conferencia-do-caixa";

export const Route = createFileRoute("/_authenticated/conferencia-do-caixa")({
  head: () => ({ meta: [{ title: "Conferência do caixa — BEX PRINT OS" }] }),
  component: ConferenciaDoCaixaPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "sem data";

/**
 * Só leitura (Fase 2A, 16/11/2026). Lista o que precisa de conferência e não muda nada: nem conta,
 * nem caixa, nem extrato. Quem abre é quem já abre o Caixa (financeiro.read); o banco filtra igual.
 */
function ConferenciaDoCaixaPage() {
  const dados = useQuery({
    queryKey: ["conferencia-do-caixa"],
    queryFn: async () => {
      const [contas, saidas, anexos, extrato, bancos] = await Promise.all([
        supabase
          .from("contas_pagar")
          .select(
            "id, descricao, fornecedor, valor, vencimento, data_pagamento, status, forma_pagamento, comprovante_url, compromisso_id",
          )
          .eq("status", "paga")
          .order("vencimento"),
        supabase
          .from("caixa_movimentos")
          .select("conta_pagar_id, conta_id, origem")
          .not("conta_pagar_id", "is", null),
        (supabase as any).from("contas_pagar_anexos").select("conta_pagar_id, tipo"),
        supabase
          .from("banco_transacoes")
          .select("id, conta_id, data, descricao, valor, tipo")
          .order("data")
          .limit(5000),
        supabase.from("contas_bancarias").select("id, nome"),
      ]);
      for (const r of [contas, saidas, anexos, extrato, bancos]) if (r.error) throw r.error;
      return {
        contas: (contas.data ?? []) as ContaPagaParaConferir[],
        saidas: saidas.data ?? [],
        anexos: (anexos.data ?? []) as { conta_pagar_id: string; tipo: string }[],
        extrato: (extrato.data ?? []) as LinhaDoExtrato[],
        bancos: new Map((bancos.data ?? []).map((b) => [b.id, b.nome] as const)),
      };
    },
  });

  if (dados.isLoading) return <Carregando />;
  if (dados.error)
    return (
      <p className="text-sm text-destructive">
        Não deu para carregar a conferência: {mensagemErro(dados.error)}
      </p>
    );

  const d = dados.data!;
  const contas = conferirContasPagas(d.contas, d.saidas, d.anexos);
  const extrato = linhasSuspeitasDoExtrato(d.extrato);
  const copiasRepetidas = extrato.repetidas.flatMap((g) => g.linhas.slice(1));
  const nomeDoBanco = (id: string | null) => (id ? (d.bancos.get(id) ?? "conta") : "sem conta");

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Conferência do caixa"
        description="Só leitura: aponta o que está pago sem prova ou sem origem e o que no extrato importado não parece lançamento. Nada aqui altera conta, caixa ou extrato."
      />

      <Secao
        titulo="Pagas sem conta de origem"
        explicacao="Conta paga sem saída no caixa com conta bancária e sem ser em dinheiro. Inclui parcelas de despesas fixas com baixa sem lançar no caixa."
        quantidade={contas.semOrigem.length}
        total={somaDosValores(contas.semOrigem.map((x) => x.conta))}
      >
        <TabelaDeContas
          linhas={contas.semOrigem.map((x) => ({
            conta: x.conta,
            nota: FRASE_DO_MOTIVO[x.motivo],
          }))}
        />
      </Secao>

      <Secao
        titulo="Pagas sem comprovante"
        explicacao="Sem comprovante anexado no clipe da conta e sem o comprovante da parcela."
        quantidade={contas.semComprovante.length}
        total={somaDosValores(contas.semComprovante)}
      >
        <TabelaDeContas linhas={contas.semComprovante.map((c) => ({ conta: c, nota: null }))} />
      </Secao>

      <Secao
        titulo="Pagas sem data de pagamento"
        explicacao="Marcadas como pagas sem dizer quando. Não entram certo no caixa nem na conferência com o banco."
        quantidade={contas.semData.length}
        total={somaDosValores(contas.semData)}
      >
        <TabelaDeContas linhas={contas.semData.map((c) => ({ conta: c, nota: null }))} />
      </Secao>

      <Secao
        titulo="Pagas com mais de uma saída no caixa"
        explicacao="O mesmo pagamento lançado duas vezes no caixa."
        quantidade={contas.saidaRepetida.length}
        total={somaDosValores(contas.saidaRepetida.map((x) => x.conta))}
      >
        <TabelaDeContas
          linhas={contas.saidaRepetida.map((x) => ({ conta: x.conta, nota: `${x.saidas} saídas` }))}
        />
      </Secao>

      <Secao
        titulo="Extrato: linhas de saldo lidas como lançamento"
        explicacao="O extrato traz o saldo do fim do dia como se fosse lançamento. Importado, ele virou entrada e infla o Saldo em conta e as entradas do caixa. Confira com o banco antes de qualquer ajuste."
        quantidade={extrato.saldoDoDia.length}
        total={somaDosValores(extrato.saldoDoDia)}
      >
        <TabelaDoExtrato linhas={extrato.saldoDoDia} nomeDoBanco={nomeDoBanco} />
      </Secao>

      <Secao
        titulo="Extrato: linhas repetidas"
        explicacao="Mesma conta, mesmo dia, mesmo valor, tipo e descrição. Podem ser dois lançamentos iguais legítimos ou cópia: só o extrato do banco decide."
        quantidade={copiasRepetidas.length}
        total={somaDosValores(copiasRepetidas)}
        rotuloDoTotal="a mais, se forem cópias"
      >
        <TabelaDoExtrato
          linhas={extrato.repetidas.flatMap((g) => g.linhas)}
          nomeDoBanco={nomeDoBanco}
        />
      </Secao>
    </div>
  );
}

function Secao({
  titulo,
  explicacao,
  quantidade,
  total,
  rotuloDoTotal,
  children,
}: {
  titulo: string;
  explicacao: string;
  quantidade: number;
  total: number;
  rotuloDoTotal?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={titulo} data-testid="secao-da-conferencia">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold">{titulo}</h2>
        <Badge variant={quantidade > 0 ? "destructive" : "secondary"}>{quantidade}</Badge>
        {quantidade > 0 && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {brl(total)}
            {rotuloDoTotal ? ` ${rotuloDoTotal}` : ""}
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{explicacao}</p>
      {quantidade === 0 ? (
        <p className="text-sm text-muted-foreground">Nada para conferir aqui.</p>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">{children}</CardContent>
        </Card>
      )}
    </section>
  );
}

function TabelaDeContas({
  linhas,
}: {
  linhas: { conta: ContaPagaParaConferir; nota: string | null }[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-56">Conta</TableHead>
          <TableHead>Fornecedor</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead>Vencimento</TableHead>
          <TableHead>Pagamento</TableHead>
          <TableHead>Observação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map(({ conta, nota }) => (
          <TableRow key={conta.id}>
            <TableCell className="break-words font-medium">{conta.descricao}</TableCell>
            <TableCell>{conta.fornecedor || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{brl(Number(conta.valor))}</TableCell>
            <TableCell className="tabular-nums">{dia(conta.vencimento)}</TableCell>
            <TableCell className="tabular-nums">{dia(conta.data_pagamento)}</TableCell>
            <TableCell className="text-muted-foreground">
              {[nota, conta.compromisso_id ? "parcela de despesa fixa" : null]
                .filter(Boolean)
                .join(" · ") || "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TabelaDoExtrato({
  linhas,
  nomeDoBanco,
}: {
  linhas: LinhaDoExtrato[];
  nomeDoBanco: (id: string | null) => string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead className="min-w-56">Descrição</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead>Conta</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map((l) => (
          <TableRow key={l.id}>
            <TableCell className="tabular-nums">{dia(l.data)}</TableCell>
            <TableCell className="break-words">{l.descricao || "—"}</TableCell>
            <TableCell>
              {l.tipo === "debito" ? "saída" : l.tipo === "credito" ? "entrada" : "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {brl(Math.abs(Number(l.valor)))}
            </TableCell>
            <TableCell>{nomeDoBanco(l.conta_id)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
