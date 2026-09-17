import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Copy, Download, FileSpreadsheet, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaAcao } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { baixarArquivo } from "@/lib/pdf/generate";
import { fechamentoDoClube, type FechamentoDoClube } from "@/lib/parceiro-api";
import { toast } from "sonner";
import { brl } from "@/domain/parceiros/preco";
import { ROTULO_DO_CREDITO, type TipoDeCredito } from "@/domain/parceiros/painel";
import { fechamentoConfere, resumoDoFechamento } from "@/domain/parceiros/contador";

/**
 * O mês do clube fechado para o contador.
 *
 * Crédito de parceiro é obrigação assumida: a gráfica deve produto ou desconto
 * futuro a alguém. Por isso a tela abre pelo saldo que veio do mês anterior,
 * mostra o que entrou e o que saiu, e termina no saldo que fica em aberto —
 * que é o número que o contador leva para o balanço. Os prêmios em produto e
 * brinde saem numa lista separada porque não são crédito: saem do estoque.
 */

const mesAtual = () => new Date().toISOString().slice(0, 7);

function limitesDoMes(mes: string): { inicio: string; fim: string } {
  const [ano, m] = mes.split("-").map(Number);
  const ultimo = new Date(ano, m, 0).getDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { inicio: `${ano}-${p(m)}-01`, fim: `${ano}-${p(m)}-${p(ultimo)}` };
}

const csv = (linhas: (string | number | null)[][]) =>
  linhas
    .map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");

export function ContadorTab() {
  const [mes, setMes] = useState(mesAtual());
  const { inicio, fim } = limitesDoMes(mes);

  const { data, isLoading, error } = useQuery({
    queryKey: ["parceiros-contador", inicio, fim],
    queryFn: () => fechamentoDoClube(inicio, fim),
  });

  const resumo = useMemo(() => resumoDoFechamento(data?.por_tipo), [data]);
  // O bundle do navegador pode ser mais novo que a função do banco (ou o contrário):
  // lista que falta vira lista vazia, e a tela continua de pé.
  const movimentos = data?.movimentos ?? [];
  const pedidos = data?.pedidos_do_periodo ?? [];
  const premios = data?.premios_entregues ?? [];
  const conferencia = useMemo(
    () =>
      data
        ? fechamentoConfere({ saldo_anterior: data.saldo_anterior, saldo_final: data.saldo_final, resumo })
        : { confere: true, diferenca: 0 },
    [data, resumo],
  );

  function baixar(f: FechamentoDoClube) {
    const linhas: (string | number | null)[][] = [
      ["Extrato do clube de parceiros", `${inicio} a ${fim}`],
      [],
      ["Saldo de crédito em aberto no início", Number(f.saldo_anterior).toFixed(2)],
      ["Concedido no período (cashback + metas + ajustes)", resumo.concedido.toFixed(2)],
      ["Usado como desconto em pedidos", resumo.usado.toFixed(2)],
      ["Devolvido (pedido recusado)", Number(resumo.devolvido).toFixed(2)],
      ["Saldo de crédito em aberto no fim", Number(f.saldo_final).toFixed(2)],
      [],
      ["Data", "Parceiro", "CPF/CNPJ", "Tipo", "Valor", "Pedido", "OS", "Descrição"],
      ...(f.movimentos ?? []).map((m) => [
        m.data,
        m.parceiro,
        m.documento,
        ROTULO_DO_CREDITO[m.tipo as TipoDeCredito] ?? m.tipo,
        Number(m.valor).toFixed(2),
        m.pedido_numero,
        m.os_numero,
        m.descricao,
      ]),
    ];
    if ((f.pedidos_do_periodo ?? []).length > 0) {
      linhas.push(
        [],
        ["Pedidos de parceiro no período — compra para REVENDA (ver ISS x ICMS com o contador)"],
        ["Data", "Pedido", "Parceiro", "CPF/CNPJ", "Valor bruto", "Desconto de crédito", "Valor líquido", "Situação", "OS"],
      );
      for (const o of f.pedidos_do_periodo ?? []) {
        linhas.push([
          o.data, o.numero, o.parceiro, o.documento,
          Number(o.valor_bruto).toFixed(2), Number(o.desconto_credito).toFixed(2), Number(o.valor_liquido).toFixed(2),
          o.status, o.os_numero,
        ]);
      }
    }
    if ((f.premios_entregues ?? []).length > 0) {
      linhas.push([], ["Prêmios entregues (produto ou brinde)"], ["Data", "Parceiro", "CPF/CNPJ", "Meta", "Tipo", "Prêmio", "Observação"]);
      for (const p of f.premios_entregues ?? []) {
        linhas.push([p.data, p.parceiro, p.documento, p.campanha, p.tipo, p.premio, p.observacao]);
      }
    }
    // BOM para o Excel abrir acentuação certa
    baixarArquivo(new Blob(["﻿" + csv(linhas)], { type: "text/csv;charset=utf-8" }), `clube-parceiros-${mes}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="mes-contador" className="flex items-center gap-1 text-xs text-muted-foreground">
            Mês
            <DicaIcone texto={dicaAcao("/parceiros", "extrato do contador")} rotulo="Extrato do contador" />
          </Label>
          <Input
            id="mes-contador"
            type="month"
            value={mes}
            max={mesAtual()}
            onChange={(e) => setMes(e.target.value || mesAtual())}
            className="w-44"
          />
        </div>
        <Button variant="outline" onClick={() => data && baixar(data)} disabled={!data}>
          <Download className="mr-1 h-4 w-4" /> Baixar planilha do mês
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : error ? (
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">{mensagemErro(error)}</p>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Numero rotulo="Saldo no início" valor={brl(data.saldo_anterior)} ajuda="Crédito que os parceiros já tinham para usar quando o mês começou." />
            <Numero rotulo="Concedido no mês" valor={brl(resumo.concedido)} ajuda="Cashback de pedidos pagos + prêmios de meta em crédito + ajustes manuais." />
            <Numero rotulo="Usado em pedidos" valor={brl(resumo.usado)} ajuda="Virou desconto destacado no pedido da gráfica. Reduz o valor a receber." />
            <Numero rotulo="Devolvido" valor={brl(resumo.devolvido)} ajuda="Crédito que voltou ao saldo porque a gráfica recusou ou o pedido expirou." />
            <Numero
              rotulo="Saldo em aberto no fim"
              valor={brl(data.saldo_final)}
              destaque
              ajuda="O que a gráfica ainda deve em desconto futuro aos parceiros. É este número que vai para o fechamento."
            />
          </div>

          {!conferencia.confere && (
            <p className="rounded-lg border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-3 text-sm">
              O saldo do fim do mês difere em {brl(conferencia.diferenca)} do que o movimento explica. Avise antes de
              entregar ao contador — pode haver lançamento fora do período.
            </p>
          )}

          <div className="flex gap-2 rounded-lg border border-border bg-foreground/5 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              O crédito usado entra como <span className="font-medium text-foreground">desconto no próprio pedido</span>, e não
              como pagamento: o documento, a OS e o contas a receber mostram o valor já abatido. Os prêmios em produto e brinde
              saem do estoque e estão na lista de baixo.
            </p>
          </div>

          <section className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-foreground/5 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Parceiro</th>
                  <th className="px-3 py-2 font-medium">CPF/CNPJ</th>
                  <th className="px-3 py-2 font-medium">Movimento</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 font-medium">Pedido / OS</th>
                </tr>
              </thead>
              <tbody>
                {movimentos.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      Nenhum movimento de crédito neste mês.
                    </td>
                  </tr>
                ) : (
                  movimentos.map((m, i) => (
                    <tr key={`${m.data}-${i}`} className="border-t border-border">
                      <td className="whitespace-nowrap px-3 py-2">{new Date(`${m.data}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                      <td className="px-3 py-2">{m.parceiro}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{m.documento ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="block">{ROTULO_DO_CREDITO[m.tipo as TipoDeCredito] ?? m.tipo}</span>
                        <span className="block text-xs text-muted-foreground">{m.descricao}</span>
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${Number(m.valor) < 0 ? "text-muted-foreground" : ""}`}>
                        {brl(Number(m.valor))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {m.pedido_numero ? `nº ${m.pedido_numero}` : "—"}
                        {m.os_numero ? ` · OS ${m.os_numero}` : ""}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          {pedidos.length > 0 && (
            <section className="rounded-xl border border-border p-4">
              <p className="flex items-center gap-2 font-medium">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                Pedidos de parceiro no período — compra para revenda
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pedido de parceiro é compra para revender. A destinação é o que decide ISS ou ICMS (LC 116/2003, item
                13.05, e STF Tema 816), então esta lista vai separada da dos pedidos de cliente final.
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Data</th>
                      <th className="py-2 pr-3 font-medium">Pedido</th>
                      <th className="py-2 pr-3 font-medium">Parceiro</th>
                      <th className="py-2 pr-3 text-right font-medium">Bruto</th>
                      <th className="py-2 pr-3 text-right font-medium">Desconto de crédito</th>
                      <th className="py-2 text-right font-medium">Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.map((o) => (
                      <tr key={o.numero} className="border-t border-border">
                        <td className="whitespace-nowrap py-2 pr-3">{new Date(`${o.data}T00:00:00`).toLocaleDateString("pt-BR")}</td>
                        <td className="py-2 pr-3">
                          nº {o.numero}
                          {o.os_numero ? <span className="text-muted-foreground"> · OS {o.os_numero}</span> : null}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="block">{o.parceiro}</span>
                          <span className="block text-xs text-muted-foreground">{o.documento ?? "sem documento"}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{brl(o.valor_bruto)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {Number(o.desconto_credito) > 0 ? `− ${brl(o.desconto_credito)}` : "—"}
                        </td>
                        <td className="py-2 text-right font-medium tabular-nums">{brl(o.valor_liquido)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <PerguntasAoContador />

          {premios.length > 0 && (
            <section className="rounded-xl border border-border p-4">
              <p className="flex items-center gap-2 font-medium">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                Prêmios entregues no mês (produto ou brinde)
              </p>
              <ul className="mt-2 divide-y divide-border text-sm">
                {premios.map((p, i) => (
                  <li key={`${p.data}-${i}`} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {new Date(`${p.data}T00:00:00`).toLocaleDateString("pt-BR")} · {p.parceiro}
                      {p.documento ? ` (${p.documento})` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {p.premio} — meta “{p.campanha}”
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  ajuda,
  destaque,
}: {
  rotulo: string;
  valor: string;
  ajuda: string;
  destaque?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${destaque ? "border-[color:var(--bex-cyan)]/40 bg-[color:var(--bex-cyan)]/5" : "border-border bg-card"}`}>
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {rotulo}
        <DicaIcone texto={ajuda} rotulo={rotulo} />
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums">{valor}</p>
    </div>
  );
}

const PERGUNTAS = [
  "Pedido de parceiro que vai revender sai com NF-e/ICMS ou NFS-e/ISS? Em qual anexo do Simples e com qual CFOP?",
  "O crédito usado deve sair na nota como desconto incondicional destacado, ou preferimos tributar cheio e tratar a concessão como despesa de bonificação? (os dois juntos, não)",
  "Na concessão do crédito, lançamos passivo (“créditos a utilizar”) ou despesa? Se for provisão, como fica a adição no lucro real?",
  "Para prêmio em produto nosso e para brinde comprado: qual nota, CFOP, CSOSN e ICMS no Amapá — e como você quer os dois separados na contabilidade?",
  "O que o regulamento do clube precisa dizer para o desconto não ser reclassificado como condicional (crédito disponível antes do pedido, regra escrita, teto por nota)?",
  "Prêmio a parceiro pessoa física e qualquer mecânica de sorteio: tem IRRF de 20%? E o que muda em 2027 para brindes e bonificações com a LC 214/2025?",
];

/** O que o dono precisa perguntar — o sistema não decide tributo por ninguém. */
function PerguntasAoContador() {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 font-medium">
        <ClipboardList className="h-4 w-4 text-[color:var(--bex-cyan)]" />
        Para levar ao contador
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        O sistema registra e comprova; quem decide o tratamento tributário é o contador, com o regime da empresa.
      </p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        {PERGUNTAS.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ol>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() =>
          navigator.clipboard.writeText(PERGUNTAS.map((q, i) => `${i + 1}. ${q}`).join("\n")).then(
            () => toast.success("Perguntas copiadas — cole no WhatsApp ou no e-mail do contador"),
            () => toast.error("Não deu para copiar. Selecione o texto e copie."),
          )
        }
      >
        <Copy className="mr-1 h-4 w-4" /> Copiar perguntas
      </Button>
    </section>
  );
}
