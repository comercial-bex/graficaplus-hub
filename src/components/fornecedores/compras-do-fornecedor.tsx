import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/bex/KpiCard";
import {
  brl,
  formatarPrecoDaUnidade,
  precosPagosPorMaterial,
  resumoDasCompras,
  ROTULO_DA_FINALIDADE,
  ROTULO_DA_SITUACAO,
  situacaoDoDocumento,
  type CompraNoFornecedor,
  type MaterialDoCadastro,
  type Situacao,
} from "@/domain/fornecedores/compras";

const DATA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Belem",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const COR_DA_SITUACAO: Record<Situacao, string> = {
  comprado: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  devolvido: "border-muted-foreground/30 bg-muted text-muted-foreground line-through",
  devolucao: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  reserva_paga: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  reserva_em_aberto: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  nao_pago: "border-destructive/40 bg-destructive/10 text-destructive",
};

const pct = (v: number) =>
  `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;

/**
 * O que foi comprado num fornecedor: quanto saiu, por quem (Agência Bex ou Bex
 * Print), para quê, o preço pago por m²/ml contra o custo do cadastro e cada
 * documento com os itens. Só leitura: nada aqui mexe em estoque, caixa ou custo.
 */
export function ComprasDoFornecedor({
  documentos,
  materiais,
  veCustoDoCadastro,
}: {
  documentos: CompraNoFornecedor[];
  materiais: MaterialDoCadastro[];
  /** Custo do cadastro só para quem vê o financeiro; quem cuida de compras vê o preço pago. */
  veCustoDoCadastro: boolean;
}) {
  const resumo = resumoDasCompras(documentos);
  const precos = precosPagosPorMaterial(documentos, materiais);
  const reservasSemNota = documentos.filter((d) => situacaoDoDocumento(d, documentos) === "reserva_paga");

  if (documentos.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Nenhuma compra registrada neste fornecedor ainda.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total pago"
          value={brl(resumo.totalPago)}
          hint={`${resumo.documentos} documento${resumo.documentos === 1 ? "" : "s"}`}
          tone="cyan"
        />
        <KpiCard label="Vendas" value={brl(resumo.vendas)} hint="Compras faturadas" tone="lime" />
        <KpiCard label="Devolvido" value={brl(resumo.devolvido)} hint="Voltou ao fornecedor" tone="muted" />
        <KpiCard
          label="Reservas pagas"
          value={brl(resumo.reservasPagas)}
          hint="Pagas, sem nota de venda"
          tone="amber"
        />
      </div>

      {reservasSemNota.length > 0 && (
        <div role="note" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <p>
            {reservasSemNota.length === 1 ? "Uma reserva foi paga" : `${reservasSemNota.length} reservas foram pagas`} e
            não virou venda no sistema do fornecedor ({reservasSemNota.map((d) => d.documento).join(", ")}). Confira se o
            material foi retirado e peça a nota.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Quem comprou</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {resumo.porComprador.map((c) => (
              <div key={c.cnpj ?? c.nome} className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">{c.cnpj ?? "CNPJ não aparece no documento"}</p>
                </div>
                <span className="tabular-nums">{brl(c.total)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Para que foi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {resumo.porFinalidade.map((f) => (
              <div key={f.finalidade} className="flex items-center justify-between gap-3">
                <span>{ROTULO_DA_FINALIDADE[f.finalidade]}</span>
                <span className="tabular-nums">{brl(f.total)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {precos.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Preço pago × custo do cadastro</CardTitle>
            <p className="text-xs text-muted-foreground">
              Preço por unidade do material (rolo ÷ m² que rende; litro ÷ 1.000 ml). O custo do cadastro é o que o
              orçamento usa hoje — nada aqui o altera.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Material do estoque</th>
                  <th className="py-1 pr-3 font-medium">Último pago</th>
                  <th className="py-1 pr-3 font-medium">Custo no cadastro</th>
                  <th className="py-1 font-medium">Cadastro × pago</th>
                </tr>
              </thead>
              <tbody>
                {precos.map((p) => (
                  <tr key={p.material.id} className="border-t">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{p.material.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.ultimoDocumento}
                        {p.menorPago !== p.maiorPago &&
                          ` · de ${formatarPrecoDaUnidade(p.menorPago, p.material.unidade)} a ${formatarPrecoDaUnidade(p.maiorPago, p.material.unidade)}`}
                      </p>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatarPrecoDaUnidade(p.ultimoPago, p.material.unidade)}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {!veCustoDoCadastro
                        ? "só o financeiro vê"
                        : p.custoNoCadastro == null
                          ? "sem custo"
                          : formatarPrecoDaUnidade(p.custoNoCadastro, p.material.unidade)}
                    </td>
                    <td className="py-2 tabular-nums">
                      {p.diferenca == null ? (
                        "—"
                      ) : (
                        <span
                          className={
                            Math.abs(p.diferenca) < 0.05
                              ? "text-muted-foreground"
                              : p.diferenca < 0
                                ? "font-medium text-destructive"
                                : "font-medium text-amber-700 dark:text-amber-300"
                          }
                        >
                          {pct(p.diferenca)}
                          {Math.abs(p.diferenca) >= 0.05 && (p.diferenca < 0 ? " · cadastro abaixo" : " · cadastro acima")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Documentos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {documentos.map((d) => (
            <Documento key={d.id} doc={d} situacao={situacaoDoDocumento(d, documentos)} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Documento({ doc, situacao }: { doc: CompraNoFornecedor; situacao: Situacao }) {
  const [aberto, setAberto] = useState(false);
  const Seta = aberto ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-md border">
      <Button
        variant="ghost"
        className="flex h-auto w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Seta className="h-4 w-4 flex-shrink-0" />
          <ReceiptText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className="font-medium">{doc.documento}</span>
          <span className="text-xs text-muted-foreground">{DATA.format(new Date(doc.data_operacao))}</span>
        </span>
        <span className="flex items-center gap-2">
          <Badge variant="outline" className={COR_DA_SITUACAO[situacao]}>
            {ROTULO_DA_SITUACAO[situacao]}
          </Badge>
          <span className="tabular-nums font-medium">{brl(doc.total)}</span>
        </span>
      </Button>
      {aberto && (
        <div className="space-y-2 border-t px-3 py-2 text-sm">
          <p className="text-xs text-muted-foreground">
            {doc.comprador_nome}
            {doc.codigo_cliente ? ` (código ${doc.codigo_cliente} no fornecedor)` : ""} ·{" "}
            {[doc.forma_pagamento, doc.condicao_pagamento].filter(Boolean).join(" · ")} · bruto {brl(doc.total_bruto)},
            desconto {brl(doc.desconto)}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Item</th>
                  <th className="py-1 pr-3 font-medium">Qtd.</th>
                  <th className="py-1 pr-3 font-medium">Preço pago</th>
                  <th className="py-1 pr-3 font-medium">Total</th>
                  <th className="py-1 font-medium">Para quê</th>
                </tr>
              </thead>
              <tbody>
                {doc.itens.map((i) => (
                  <tr key={i.id} className="border-t">
                    <td className="py-1.5 pr-3">
                      <span className="font-mono text-xs text-muted-foreground">{i.codigo}</span> {i.descricao}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {i.quantidade.toLocaleString("pt-BR")} {i.unidade}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {brl(i.preco_unitario)}
                      {i.preco_lista != null && i.preco_lista !== i.preco_unitario && (
                        <span className="block text-xs text-muted-foreground">tabela {brl(i.preco_lista)}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{brl(i.total)}</td>
                    <td className="py-1.5">{ROTULO_DA_FINALIDADE[i.finalidade]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {doc.observacoes && <p className="text-xs">{doc.observacoes}</p>}
          {doc.fonte && <p className="text-xs text-muted-foreground">Fonte: {doc.fonte}</p>}
        </div>
      )}
    </div>
  );
}
