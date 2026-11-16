import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { lerPrecosPorProduto, proporPreco } from "@/lib/api/precos-por-produto.functions";
import {
  contar,
  familiasDe,
  filtrar,
  ordenar,
  ROTULO_DO_PROBLEMA,
  type FiltroDeProblema,
  type Ordem,
  type Problema,
} from "@/domain/precos/painel-de-precos";
import {
  LEGENDA_DAS_SITUACOES,
  ListaDePrecos,
  type PedirPreco,
} from "@/components/precos/painel-de-precos";

export const Route = createFileRoute("/_authenticated/precos")({
  head: () => ({ meta: [{ title: "Preços por produto — BEX PRINT OS" }] }),
  component: PrecosPage,
});

const CHAVE_DOS_PRECOS = ["precos-por-produto"];

const NUMEROS: Problema[] = ["abaixo", "sem_custo", "sem_preco", "parceiro_acima"];
const ORDENS: Array<{ valor: Ordem; rotulo: string }> = [
  { valor: "problema", rotulo: "Problemas primeiro" },
  { valor: "nome", rotulo: "Nome" },
  { valor: "preco", rotulo: "Preço, do menor ao maior" },
  { valor: "margem", rotulo: "Margem, da menor à maior" },
];

const BOTAO_FILTRO =
  "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PrecosPage() {
  const qc = useQueryClient();
  const ler = useServerFn(lerPrecosPorProduto);
  const pedir = useServerFn(proporPreco);
  const painel = useQuery({ queryKey: CHAVE_DOS_PRECOS, queryFn: () => ler() });
  const [familia, setFamilia] = useState<string | null>(null);
  const [problema, setProblema] = useState<FiltroDeProblema>("todos");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("problema");

  const criando = useMutation({
    mutationFn: (v: { produtoId: string; preco: number; motivo: string }) => pedir({ data: v }),
    onSuccess: () => {
      toast.success("Proposta criada. Ela espera aprovação em preços pendentes.");
      void qc.invalidateQueries({ queryKey: ["precos-pendentes"] });
    },
  });
  const propor: PedirPreco = async (v) => {
    try {
      await criando.mutateAsync(v);
    } catch (e) {
      throw new Error(mensagemErro(e));
    }
  };

  const linhas = painel.data?.linhas;
  const contagem = useMemo(() => contar(linhas ?? []), [linhas]);
  const familias = useMemo(() => familiasDe(linhas ?? []), [linhas]);
  const visiveis = useMemo(
    () => ordenar(filtrar(linhas ?? [], { familia, problema, busca }), ordem),
    [linhas, familia, problema, busca, ordem],
  );

  return (
    <div className="space-y-4 text-base">
      <SectionHeader
        breadcrumb="Custeio"
        title="Preços por produto"
        description="Veja o piso e a margem de cada produto e peça a mudança de preço. O preço só muda depois que alguém aprova em preços pendentes."
        ajuda={dicaTela("/precos")}
        legivel
      />

      {painel.isLoading ? (
        <Carregando />
      ) : painel.isError ? (
        <Card>
          <CardContent className="p-4 text-base text-destructive" role="alert">
            Não deu para carregar os preços. {mensagemErro(painel.error)}
          </CardContent>
        </Card>
      ) : painel.data ? (
        <>
          <div
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            role="group"
            aria-label="Problemas encontrados, toque para filtrar"
          >
            {NUMEROS.map((p) => {
              const ativo = problema === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setProblema(ativo ? "todos" : p)}
                  className={cn(
                    "min-h-11 rounded-xl border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ativo ? "border-primary ring-2 ring-primary" : "border-border",
                  )}
                  data-testid={`numero-${p}`}
                >
                  <span className="block text-3xl font-bold">{contagem[p]}</span>
                  <span className="block text-base">{ROTULO_DO_PROBLEMA[p]}</span>
                </button>
              );
            })}
          </div>

          {contagem.abaixo > 0 ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#b42318] bg-card p-4 dark:border-[#ff8a80]"
              role="status"
              data-testid="aviso-abaixo-do-piso"
            >
              <p className="min-w-0 flex-1 basis-64 font-semibold">
                {contagem.abaixo === 1
                  ? "Este produto vende abaixo do piso."
                  : `Estes ${contagem.abaixo} produtos vendem abaixo do piso.`}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-11 min-h-11 text-base"
                onClick={() => setProblema("abaixo")}
              >
                Ver só {contagem.abaixo === 1 ? "este" : "estes"}
              </Button>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por família">
              <button
                type="button"
                aria-pressed={familia === null}
                onClick={() => setFamilia(null)}
                className={cn(
                  BOTAO_FILTRO,
                  familia === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card",
                )}
              >
                Todas as famílias
              </button>
              {familias.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={familia === f}
                  onClick={() => setFamilia(familia === f ? null : f)}
                  className={cn(
                    BOTAO_FILTRO,
                    familia === f
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-56 flex-1">
                <span className="font-medium">Buscar produto</span>
                <Input
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Digite parte do nome"
                  className="mt-1 h-11 text-base md:text-base"
                />
              </label>
              <label className="block">
                <span className="font-medium">Ordem</span>
                <select
                  value={ordem}
                  onChange={(e) => setOrdem(e.target.value as Ordem)}
                  className="mt-1 block h-11 w-full min-w-56 rounded-md border border-input bg-card px-3 text-base"
                >
                  {ORDENS.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </label>
              {problema !== "todos" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-h-11 text-base"
                  onClick={() => setProblema("todos")}
                >
                  Limpar filtro: {ROTULO_DO_PROBLEMA[problema]}
                </Button>
              ) : null}
            </div>
          </div>

          <ul className="space-y-1" aria-label="Legenda das cores">
            {LEGENDA_DAS_SITUACOES.map((l) => (
              <li key={l.faixa}>{l.texto}</li>
            ))}
          </ul>

          {!painel.data.podePropor ? (
            <p className="rounded-xl border border-border bg-card p-4" data-testid="so-leitura">
              Só administrador ou gerente pede mudança de preço. Você pode ver o piso e a margem.
            </p>
          ) : null}

          <p aria-live="polite" data-testid="contagem-da-lista">
            {visiveis.length === 1
              ? "1 produto na lista."
              : `${visiveis.length} produtos na lista.`}
          </p>

          {visiveis.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-base" data-testid="estado-vazio">
                <p className="font-semibold">Nenhum produto com esse filtro.</p>
                <p className="mt-1">Limpe o filtro ou mude a busca.</p>
              </CardContent>
            </Card>
          ) : (
            <ListaDePrecos linhas={visiveis} propor={propor} podePropor={painel.data.podePropor} />
          )}
        </>
      ) : null}
    </div>
  );
}
