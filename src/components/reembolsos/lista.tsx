import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusChip } from "@/components/bex/StatusChip";
import {
  COR,
  ROTULO_DA_SITUACAO,
  TOM_DA_SITUACAO,
  fraseDaMargem,
  hojeNaCasa,
  motivoParaNaoDecidir,
  precisaDeMotivo,
  rotuloDaCategoria,
  sextaDoPagamento,
} from "@/domain/financeiro/reembolsos";
import {
  CHAVE_DOS_REEMBOLSOS,
  consultarSemaforo,
  ehPdf,
  linkDoComprovante,
  type Reembolso,
} from "@/components/reembolsos/dados";
import { Carregando } from "@/components/bex/Carregando";

export const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const dia = (d: string | null | undefined) => {
  if (!d) return "—";
  const [a, m, dd] = d.slice(0, 10).split("-");
  return `${dd}/${m}/${a}`;
};

/** Abre a foto do cupom numa aba nova (o link vale 10 minutos). */
export function BotaoDoComprovante({ caminho }: { caminho: string }) {
  const [abrindo, setAbrindo] = useState(false);
  async function abrir() {
    // A aba abre no clique; o endereço chega depois. Abrir só depois do await
    // faz o celular tratar como janela não pedida e bloquear.
    const aba = window.open("", "_blank");
    setAbrindo(true);
    try {
      const url = await linkDoComprovante(caminho);
      if (aba) aba.location.href = url;
      else window.location.href = url;
    } catch (e) {
      aba?.close();
      toast.error(mensagemErro(e));
    } finally {
      setAbrindo(false);
    }
  }
  return (
    <Button type="button" variant="ghost" size="sm" onClick={abrir} disabled={abrindo}>
      {ehPdf(caminho) ? <FileText className="mr-1 h-4 w-4" /> : <ReceiptText className="mr-1 h-4 w-4" />}
      {abrindo ? "Abrindo…" : "Ver cupom"}
    </Button>
  );
}

/** Um pedido de reembolso, no formato de cartão (cabe no celular). */
export function CartaoDoReembolso({
  r,
  mostrarQuemPediu = true,
  acoes,
}: {
  r: Reembolso;
  mostrarQuemPediu?: boolean;
  acoes?: ReactNode;
}) {
  return (
    <li className="rounded-lg border border-border bg-card p-3" data-reembolso={r.numero}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            nº {r.numero} · {brl(r.valor)}
            {mostrarQuemPediu && <span className="font-normal text-muted-foreground"> · {r.solicitante}</span>}
          </p>
          <p className="break-words text-sm">{r.descricao}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.destino === "os" && <StatusChip label={COR[r.cor].rotulo} tone={COR[r.cor].tom} />}
          <StatusChip label={ROTULO_DA_SITUACAO[r.status]} tone={TOM_DA_SITUACAO[r.status]} />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {r.destino === "os" && r.os_id ? (
          <Link to="/os/$id" params={{ id: r.os_id }} className="underline-offset-2 hover:underline">
            OS #{r.os?.numero ?? "?"}
            {r.os?.titulo ? ` · ${r.os.titulo.trim()}` : ""}
          </Link>
        ) : (
          "Despesa da empresa"
        )}
        {" · "}
        {rotuloDaCategoria(r.categoria)} · cupom de {dia(r.data_compra)}
        {r.fornecedor ? ` · ${r.fornecedor}` : ""}
        {r.depois_do_fechamento ? " · pedido depois de a OS fechar" : ""}
      </p>
      {r.decidido_em && (r.status === "aprovado" || r.status === "recusado" || r.status === "pago") && (
        <p className="mt-1 text-xs text-muted-foreground">
          {r.status === "recusado" ? "Recusado" : "Aprovado"} por {r.decisor ?? "Equipe"} em {dia(r.decidido_em)}
          {r.motivo_decisao ? ` — “${r.motivo_decisao}”` : ""}
          {r.status === "pago" && r.pago_em ? ` · pago em ${dia(r.pago_em)}` : ""}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <BotaoDoComprovante caminho={r.comprovante_path} />
        {acoes}
      </div>
    </li>
  );
}

/**
 * A decisão. Mostra o cupom, a OS e o semáforo DE AGORA (o banco recalcula na
 * hora de gravar), com a margem antes e depois. O botão só aparece para quem o
 * banco deixaria decidir; o banco confere de novo.
 */
export function DecidirReembolso({ r, aoFechar }: { r: Reembolso | null; aoFechar: () => void }) {
  const { user, hasPermission, hasRole } = useAuth();
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");

  const semaforo = useQuery({
    queryKey: ["reembolso-semaforo-decisao", r?.id, r?.status],
    enabled: !!r && r.destino === "os" && !!r.os_id && r.status === "aguardando",
    queryFn: () => consultarSemaforo(r!.os_id as string, r!.valor, r!.id),
  });
  const foto = useQuery({
    queryKey: ["reembolso-foto", r?.comprovante_path],
    enabled: !!r && !ehPdf(r.comprovante_path),
    staleTime: 5 * 60 * 1000,
    queryFn: () => linkDoComprovante(r!.comprovante_path),
  });

  const corAgora = r?.destino === "os" ? (semaforo.data?.cor ?? r.cor) : (r?.cor ?? "empresa");
  const bloqueio = r
    ? motivoParaNaoDecidir(
        { status: r.status, cor: corAgora, solicitante_id: r.solicitante_id },
        {
          uid: user?.id,
          aprovaTudo: hasPermission("reembolsos.approve"),
          aprovaVerde: hasPermission("reembolsos.pay"),
          ehAdmin: hasRole("admin"),
        },
      )
    : null;

  const decidir = useMutation({
    mutationFn: async (aprovar: boolean) => {
      if (!r) throw new Error("Escolha um reembolso.");
      if (precisaDeMotivo(aprovar, corAgora) && !motivo.trim()) {
        throw new Error(aprovar ? "Este deixa a OS no prejuízo: escreva o motivo da aprovação." : "Escreva o motivo da recusa.");
      }
      const { data, error } = await (supabase as any).rpc("reembolso_decidir", {
        p_id: r.id,
        p_aprovar: aprovar,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      return data as { status: string; vence?: string };
    },
    onSuccess: (d) => {
      if (d.status === "aprovado") {
        const vence = d.vence ?? sextaDoPagamento(hojeNaCasa());
        toast.success(`Aprovado: entra na conta da sexta ${dia(vence).slice(0, 5)} de ${r?.solicitante ?? "quem pediu"}.`);
      } else {
        toast.success("Recusado. Quem pediu vê o motivo em Meus reembolsos.");
      }
      qc.invalidateQueries({ queryKey: [CHAVE_DOS_REEMBOLSOS] });
      setMotivo("");
      aoFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const s = semaforo.data;
  const margem = fraseDaMargem(s);

  return (
    <Dialog open={!!r} onOpenChange={(o) => !o && !decidir.isPending && aoFechar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        {r && (
          <>
            <DialogHeader>
              <DialogTitle>
                Reembolso nº {r.numero} · {brl(r.valor)}
              </DialogTitle>
              <DialogDescription>
                {r.solicitante} pediu em {dia(r.created_at)}: {r.descricao}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {r.destino === "os" ? `OS #${r.os?.numero ?? "?"}${r.os?.titulo ? ` · ${r.os.titulo.trim()}` : ""}` : "Despesa da empresa"}
                {" · "}
                {rotuloDaCategoria(r.categoria)} · cupom de {dia(r.data_compra)}
                {r.fornecedor ? ` · ${r.fornecedor}` : ""}
              </p>

              {ehPdf(r.comprovante_path) ? (
                <BotaoDoComprovante caminho={r.comprovante_path} />
              ) : foto.isError ? (
                <p role="alert" className="text-destructive">
                  Não foi possível abrir a foto: {mensagemErro(foto.error)}
                </p>
              ) : foto.data ? (
                <a href={foto.data} target="_blank" rel="noreferrer">
                  <img
                    src={foto.data}
                    alt={`Cupom do reembolso nº ${r.numero}`}
                    className="max-h-72 w-full rounded-md border border-border object-contain"
                  />
                  <span className="mt-1 block text-xs text-link underline underline-offset-2">Abrir a foto inteira</span>
                </a>
              ) : (
                <p className="text-muted-foreground">Carregando a foto do cupom…</p>
              )}

              {r.destino === "os" && r.status === "aguardando" && (
                <div className="rounded-lg border border-border bg-muted/40 p-3" aria-live="polite">
                  {semaforo.isPending ? (
                    <p className="text-muted-foreground">Conferindo a margem da OS…</p>
                  ) : semaforo.isError ? (
                    <p role="alert" className="text-destructive">
                      Não foi possível conferir a OS: {mensagemErro(semaforo.error)}
                    </p>
                  ) : s ? (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip label={COR[s.cor].rotulo} tone={COR[s.cor].tom} />
                        <span className="font-medium">{COR[s.cor].quem}</span>
                      </div>
                      <p className="text-muted-foreground">{s.motivo}</p>
                      {margem && <p className="font-medium">{margem}</p>}
                      {s.venda != null && (
                        <p className="text-xs text-muted-foreground">
                          Venda {brl(s.venda)} · custo {brl(s.custo_antes)} → {brl(s.custo_depois)}
                          {s.reembolsado ? ` · já reembolsado nesta OS ${brl(s.reembolsado)}` : ""}
                          {s.pendentes ? ` · pedidos antes deste ${brl(s.pendentes)}` : ""}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {bloqueio ? (
                <p className="rounded-lg border border-border bg-muted/40 p-3 font-medium">{bloqueio}</p>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="reembolso-motivo">
                    Motivo {corAgora === "vermelho" ? "(obrigatório: a OS fica no prejuízo)" : "(obrigatório para recusar)"}
                  </Label>
                  <Textarea
                    id="reembolso-motivo"
                    rows={2}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder={corAgora === "vermelho" ? "ex.: cliente antigo, a entrega não podia atrasar" : "ex.: compra não combinada antes"}
                  />
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={aoFechar} disabled={decidir.isPending}>
                Fechar
              </Button>
              {!bloqueio && (
                <>
                  <Button variant="outline" onClick={() => decidir.mutate(false)} disabled={decidir.isPending}>
                    Recusar
                  </Button>
                  <Button onClick={() => decidir.mutate(true)} disabled={decidir.isPending || (r.destino === "os" && semaforo.isPending)}>
                    {decidir.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Aprovar
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Estados de carga e erro da lista: falha não pode se ler como "nenhum pedido". */
export function EstadoDaLista({
  carregando,
  erro,
  vazio,
  textoVazio,
  children,
}: {
  carregando: boolean;
  erro: unknown;
  vazio: boolean;
  textoVazio: string;
  children: ReactNode;
}) {
  if (carregando) return <Carregando />;
  if (erro)
    return (
      <p role="alert" className="py-6 text-center text-sm text-destructive">
        Não foi possível ler os reembolsos: {mensagemErro(erro)}
      </p>
    );
  if (vazio) return <p className="py-6 text-center text-sm text-muted-foreground">{textoVazio}</p>;
  return <>{children}</>;
}
