import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, Loader2, RefreshCw, Upload } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";
import { mensagemErro } from "@/lib/erros";
import { deCSV } from "@/domain/custos/planilha-csv";
import { ROTULO_DA_MODALIDADE } from "@/domain/catalogo/modalidades";
import { emReais } from "@/domain/catalogo/preco-de-venda";
import {
  lerPlanilha,
  linhasDoFornecedor,
  montarPlano,
  type Celula,
  type ItemExistente,
  type LinhaDaPrevia,
  type PlanoDeImportacao,
  type PreviaDaSincronizacao,
  type ProblemaDaPlanilha,
} from "@/domain/catalogo/importacao";
import type { ItemDoCatalogo, PrecosDoCatalogo, SecaoDoCatalogo } from "@/domain/catalogo/itens";
import { importarPlanilha, lerImportacoes } from "@/components/catalogo/consultas";
import { dataCurta } from "@/domain/portal/link-do-portal";

type Leitura =
  | { estado: "vazio" }
  | { estado: "lendo" }
  | { estado: "problemas"; arquivo: string; problemas: ProblemaDaPlanilha[] }
  | { estado: "pronto"; arquivo: string; plano: PlanoDeImportacao; previa: PreviaDaSincronizacao; ignoradas: string[] };

/** Abas de texto que viram nota da importação, quando a planilha as traz. */
const ABAS_DE_NOTAS = ["regras", "duvidas"];

async function lerArquivo(arquivo: File): Promise<{ dados: Celula[][]; notas: string[] }> {
  if (/\.csv$/i.test(arquivo.name) || arquivo.type === "text/csv") {
    const linhas = deCSV(await arquivo.text());
    if (linhas.length === 0) return { dados: [], notas: [] };
    const colunas = Object.keys(linhas[0]);
    return { dados: [colunas, ...linhas.map((l) => colunas.map((c) => l[c] ?? null))], notas: [] };
  }
  // O leitor de .xlsx só desce para o navegador de quem abre esta aba.
  const { default: lerXlsx } = await import("read-excel-file/browser");
  const abas = await lerXlsx(arquivo);
  const dados =
    abas.find((a) => a.sheet.trim().toLowerCase() === "dados")?.data ?? abas[0]?.data ?? [];
  const notas = abas
    .filter((a) => ABAS_DE_NOTAS.includes(a.sheet.trim().toLowerCase()))
    .flatMap((a) => a.data.slice(1).map((linha) => String(linha[0] ?? "").trim()))
    .filter(Boolean);
  return { dados: dados as Celula[][], notas };
}

/** O catálogo como o planejador lê: itens + custo de cada opção (do nível financeiro). */
function itensExistentes(itens: ItemDoCatalogo[], precos: PrecosDoCatalogo): ItemExistente[] {
  return itens.map((i) => ({
    id: i.id,
    codigoFornecedor: i.codigo_fornecedor,
    descricao: i.descricao,
    situacao: i.situacao,
    secaoId: i.secao_id,
    unidade: i.unidade_preco,
    quantidadeMinima: i.quantidade_minima,
    multiplo: i.multiplo,
    quantidadeMinimaGravada: i.quantidade_minima_gravada,
    dimensoes: i.dimensoes,
    embalagem: i.embalagem,
    eEmbalagem: i.e_embalagem,
    observacao: i.observacao,
    ordem: i.ordem,
    modalidades: i.modalidades.map((m) => {
      const p = precos.precos[i.id]?.find((x) => x.modalidade === m.modalidade);
      return {
        modalidade: m.modalidade,
        quantidadeMinima: m.quantidade_minima,
        multiplo: m.multiplo,
        faixa: m.faixa,
        faixaMax: m.faixa_max,
        rotuloInferido: m.rotulo_inferido,
        custo: p?.custo ?? null,
        adicionalPorCor: p?.adicional_por_cor ?? null,
      };
    }),
  }));
}

/**
 * Sincronizar com a planilha nova do fornecedor. Só para quem gerencia o
 * catálogo E vê o financeiro: a planilha é custo.
 *
 * Nada é gravado ao escolher o arquivo. A tela lê, casa com o que existe e
 * mostra a prévia — novos, custo que subiu, custo que desceu, os que saem da
 * tabela, os que voltam — e só "Aplicar" chama o banco, que confere tudo de
 * novo. Item que sai da tabela nunca é apagado: vira "fora da tabela" e fica
 * sob consulta.
 */
export function SincronizarPlanilha({
  catalogoId,
  fornecedor,
  secoes,
  itens,
  precos,
}: {
  catalogoId: string;
  fornecedor: string;
  secoes: SecaoDoCatalogo[];
  itens: ItemDoCatalogo[];
  precos: PrecosDoCatalogo | null;
}) {
  const qc = useQueryClient();
  const [leitura, setLeitura] = useState<Leitura>({ estado: "vazio" });
  const [confirmar, setConfirmar] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const historico = useQuery({
    queryKey: ["catalogo-importacoes", catalogoId],
    queryFn: () => lerImportacoes(catalogoId),
  });

  const precosProntos = precos?.nivel === "financeiro";

  async function escolher(arquivo: File | undefined) {
    if (!arquivo || !precos) return;
    setLeitura({ estado: "lendo" });
    try {
      const { dados, notas } = await lerArquivo(arquivo);
      const lida = lerPlanilha(dados);
      if (lida.problemas.length > 0) {
        setLeitura({ estado: "problemas", arquivo: arquivo.name, problemas: lida.problemas });
        return;
      }
      const { linhas, outros } = linhasDoFornecedor(lida.linhas, fornecedor);
      if (linhas.length === 0) {
        setLeitura({
          estado: "problemas",
          arquivo: arquivo.name,
          problemas: [
            {
              linha: null,
              mensagem: `A planilha não traz linhas de ${fornecedor}. Fornecedores encontrados: ${outros.join(", ") || "nenhum"}.`,
            },
          ],
        });
        return;
      }
      const { plano, previa } = montarPlano({
        linhas,
        secoes,
        itens: itensExistentes(itens, precos),
        arquivo: arquivo.name,
        notas,
      });
      setLeitura({ estado: "pronto", arquivo: arquivo.name, plano, previa, ignoradas: outros });
    } catch (e) {
      setLeitura({
        estado: "problemas",
        arquivo: arquivo.name,
        problemas: [{ linha: null, mensagem: `Não deu para ler o arquivo: ${mensagemErro(e)}` }],
      });
    }
  }

  async function aplicar() {
    if (leitura.estado !== "pronto") return;
    setAplicando(true);
    try {
      const r = await importarPlanilha(catalogoId, leitura.plano);
      toast.success(
        `Sincronizado: ${r.novos} novos, ${r.subiram} subiram, ${r.desceram} desceram, ${r.sairam} saíram, ${r.voltaram} voltaram, ${r.iguais} iguais.`,
      );
      setLeitura({ estado: "vazio" });
      for (const chave of ["catalogo-itens", "catalogo-precos", "catalogo-secoes", "catalogo-importacoes", "catalogo"]) {
        qc.invalidateQueries({ queryKey: [chave, catalogoId] });
      }
      qc.invalidateQueries({ queryKey: ["catalogo-resumo"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setAplicando(false);
      setConfirmar(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planilha nova do fornecedor</CardTitle>
          <CardDescription>
            A mesma planilha da primeira carga (aba "dados", uma linha por item, uma coluna de custo por opção) em .xlsx, ou o mesmo
            conteúdo em .csv do Excel. Todo valor da planilha é CUSTO.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!precosProntos ? (
            <p className="text-sm text-muted-foreground">Carregando os custos atuais para comparar…</p>
          ) : (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-4 py-3 text-sm hover:bg-muted">
              <Upload className="h-4 w-4" />
              <span>{leitura.estado === "lendo" ? "Lendo a planilha…" : "Escolher a planilha (.xlsx ou .csv)"}</span>
              <Input
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="sr-only"
                disabled={leitura.estado === "lendo" || aplicando}
                onChange={(e) => {
                  void escolher(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          )}

          {leitura.estado === "problemas" && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="flex items-center gap-1 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> {leitura.arquivo}: a planilha tem problemas e não foi aplicada.
              </p>
              <ul className="max-h-60 space-y-0.5 overflow-y-auto text-destructive">
                {leitura.problemas.slice(0, 50).map((p, i) => (
                  <li key={i}>
                    {p.linha ? `Linha ${p.linha}: ` : ""}
                    {p.mensagem}
                  </li>
                ))}
              </ul>
              {leitura.problemas.length > 50 && (
                <p className="text-destructive">…e mais {leitura.problemas.length - 50} problemas.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {leitura.estado === "pronto" && (
        <PreviaDaPlanilha
          arquivo={leitura.arquivo}
          plano={leitura.plano}
          previa={leitura.previa}
          ignoradas={leitura.ignoradas}
          itens={itens}
          aplicando={aplicando}
          onAplicar={() => setConfirmar(true)}
          onDescartar={() => setLeitura({ estado: "vazio" })}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimas sincronizações</CardTitle>
        </CardHeader>
        <CardContent>
          {historico.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : historico.isError ? (
            <FalhaDeConsulta
              titulo="Não deu para carregar o histórico"
              erro={historico.error}
              onTentarDeNovo={() => void historico.refetch()}
            />
          ) : historico.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma ainda.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {historico.data.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{dataCurta(h.feito_em)}</span>
                  <span className="text-muted-foreground">
                    {h.tipo === "carga_inicial" ? "carga inicial" : (h.arquivo ?? "planilha")}
                    {h.edicao ? ` · ${h.edicao}` : ""}
                  </span>
                  {h.tipo !== "carga_inicial" && (
                    <span className="text-muted-foreground">
                      · {h.novos} novos, {h.subiram} subiram, {h.desceram} desceram, {h.sairam} saíram, {h.voltaram}{" "}
                      voltaram, {h.iguais} iguais
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar a planilha?</AlertDialogTitle>
            <AlertDialogDescription>
              Os custos mudam já e, com eles, os preços de venda — inclusive nos links que os clientes têm abertos.
              Itens que saíram da planilha ficam "fora da tabela" (sob consulta), não são apagados. Cada custo antigo
              fica no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={aplicando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={aplicando}
              onClick={(e) => {
                e.preventDefault();
                void aplicar();
              }}
            >
              {aplicando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PreviaDaPlanilha({
  arquivo,
  plano,
  previa,
  ignoradas,
  itens,
  aplicando,
  onAplicar,
  onDescartar,
}: {
  arquivo: string;
  plano: PlanoDeImportacao;
  previa: PreviaDaSincronizacao;
  ignoradas: string[];
  itens: ItemDoCatalogo[];
  aplicando: boolean;
  onAplicar: () => void;
  onDescartar: () => void;
}) {
  const bxPorId = useMemo(() => new Map(itens.map((i) => [i.id, i.codigo_bex])), [itens]);
  const nada =
    previa.novos.length + previa.subiram.length + previa.desceram.length + previa.outras.length +
      previa.voltaram.length + previa.sairam.length + previa.cadastroMudou.length ===
    0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSpreadsheet className="h-4 w-4" /> Prévia: {arquivo}
        </CardTitle>
        <CardDescription>
          {plano.itens.length} linhas{plano.edicao ? ` · tabela ${plano.edicao}` : ""}. Nada foi gravado ainda.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Numero rotulo="Novos" valor={previa.novos.length} />
          <Numero rotulo="Custo subiu" valor={previa.subiram.length} />
          <Numero rotulo="Custo desceu" valor={previa.desceram.length} />
          <Numero rotulo="Outra mudança" valor={previa.outras.length} />
          <Numero rotulo="Voltaram" valor={previa.voltaram.length} />
          <Numero rotulo="Saem da tabela" valor={previa.sairam.length} />
          <Numero rotulo="Iguais" valor={previa.iguais} />
        </div>

        {ignoradas.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Linhas de outros fornecedores ignoradas: {ignoradas.join(", ")}.
          </p>
        )}
        {previa.secoesNovas.length > 0 && (
          <p className="text-sm">Seções novas: {previa.secoesNovas.join(", ")}.</p>
        )}
        {previa.avisos.map((a) => (
          <p key={a} className="flex items-start gap-1 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {a}
          </p>
        ))}
        {nada && <p className="text-sm">A planilha é igual ao catálogo: aplicar só registra a conferência.</p>}

        <ListaDaPrevia titulo="Custo subiu" linhas={previa.subiram} bx={bxPorId} />
        <ListaDaPrevia titulo="Custo desceu" linhas={previa.desceram} bx={bxPorId} />
        <ListaDaPrevia titulo="Outra mudança de custo (opção nova ou que saiu)" linhas={previa.outras} bx={bxPorId} />
        <ListaDaPrevia titulo="Novos (entram sem foto: aponte depois)" linhas={previa.novos} bx={bxPorId} />
        <ListaDaPrevia titulo="Voltaram para a tabela" linhas={previa.voltaram} bx={bxPorId} />
        {previa.sairam.length > 0 && (
          <Detalhes titulo={`Saem da tabela (${previa.sairam.length}) — ficam sob consulta`}>
            <ul className="space-y-0.5 text-xs">
              {previa.sairam.map((s) => (
                <li key={s.id}>
                  <span className="font-mono">{bxPorId.get(s.id)}</span> · {s.codigoFornecedor} · {s.descricao}
                </li>
              ))}
            </ul>
          </Detalhes>
        )}
        {previa.cadastroMudou.length > 0 && (
          <Detalhes titulo={`Cadastro que muda sem mudar custo (${previa.cadastroMudou.length})`}>
            <ul className="space-y-0.5 text-xs">
              {previa.cadastroMudou.map((c) => (
                <li key={c.itemId}>
                  <span className="font-mono">{bxPorId.get(c.itemId)}</span> · {c.linha.codigo}: {c.campos.join("; ")}
                </li>
              ))}
            </ul>
          </Detalhes>
        )}

        <div className="flex flex-wrap gap-2">
          <Button className="h-11 md:h-9" disabled={aplicando} onClick={onAplicar}>
            {aplicando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            Aplicar a planilha
          </Button>
          <Button variant="outline" className="h-11 md:h-9" disabled={aplicando} onClick={onDescartar}>
            Descartar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-md border border-border p-2 text-center">
      <p className="text-lg font-semibold">{valor}</p>
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
    </div>
  );
}

function Detalhes({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="rounded-md border border-border p-2">
      <summary className="cursor-pointer text-sm font-medium">{titulo}</summary>
      <div className="mt-2 max-h-72 overflow-y-auto">{children}</div>
    </details>
  );
}

function ListaDaPrevia({
  titulo,
  linhas,
  bx,
}: {
  titulo: string;
  linhas: LinhaDaPrevia[];
  bx: Map<string, string>;
}) {
  if (linhas.length === 0) return null;
  return (
    <Detalhes titulo={`${titulo} (${linhas.length})`}>
      <ul className="space-y-1 text-xs">
        {linhas.map((l) => (
          <li key={`${l.linha.linhaNaPlanilha}`}>
            <span className="font-mono">{l.itemId ? bx.get(l.itemId) : "novo"}</span> · {l.linha.codigo} ·{" "}
            {l.linha.descricao}
            {l.custos.length > 0 && (
              <span className="text-muted-foreground">
                {" "}
                —{" "}
                {l.custos
                  .map(
                    (c) =>
                      `${ROTULO_DA_MODALIDADE[c.modalidade]}: ${c.antes != null ? emReais(c.antes) : "—"} → ${c.depois != null ? emReais(c.depois) : "saiu"}`,
                  )
                  .join("; ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Detalhes>
  );
}
