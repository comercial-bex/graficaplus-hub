/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { StatusChip } from "@/components/bex/StatusChip";
import { EnviarParaAprovacao } from "@/components/arquivos/enviar-para-aprovacao";
import { formatDateTime } from "@/lib/module-data";
import { mensagemErro } from "@/lib/erros";
import { rotuloDe } from "@/domain/os/etapas";
import { MiniaturaDaArte } from "./miniatura-da-arte";
import { ComentariosDaArte } from "./comentarios-da-arte";
import { DecisaoDaArte } from "./decisao-da-arte";
import {
  orcamentoDoCaminho,
  pedidoDeAjuste,
  situacaoDaArte,
  ultimaDecisao,
  type DecisaoRegistrada,
} from "./tipo-de-arquivo";

/** A linha de `arquivos` com o que a fila embute (ver a consulta em design.tsx). */
export type ArteDaFila = {
  id: string;
  os_id: string | null;
  cliente_id: string | null;
  nome: string;
  caminho: string;
  bucket: string | null;
  mime_type: string | null;
  mime: string | null;
  tamanho_bytes: number | null;
  tamanho: number | null;
  versao: number;
  status: string;
  tipo: string;
  created_at: string;
  ordens_servico: {
    numero: number | null;
    titulo: string | null;
    status: string | null;
    cliente_id: string | null;
    designer_id: string | null;
    clientes: { nome: string | null; telefone: string | null } | null;
    usuarios: { nome: string | null } | null;
  } | null;
  clientes: { nome: string | null } | null;
  arquivo_aprovacoes: DecisaoRegistrada[] | null;
  arquivo_comentarios: { count: number }[] | null;
};

export type PermissoesDaFila = {
  /** registrar_aprovacao_interna exige os.update. */
  decidir: boolean;
  /** criar_link_aprovacao exige arquivos.request_approval. */
  pedirAoCliente: boolean;
  /** concluir = marcar final de produção (arquivos.finalize). */
  concluir: boolean;
  verOrcamento: boolean;
};

export function CartaoDaArte({
  arte,
  pode,
  vista,
  onVista,
}: {
  arte: ArteDaFila;
  pode: PermissoesDaFila;
  vista: boolean;
  onVista: (id: string) => void;
}) {
  const qc = useQueryClient();
  const os = arte.ordens_servico;
  const situacao = situacaoDaArte(arte.status);
  const ajuste = arte.status === "rejeitado" ? pedidoDeAjuste(arte.arquivo_aprovacoes) : null;
  const ultima = ultimaDecisao(arte.arquivo_aprovacoes);
  const comentarios = arte.arquivo_comentarios?.[0]?.count ?? 0;
  const orcamentoId = arte.os_id ? null : orcamentoDoCaminho(arte.caminho);
  // Nome do cliente só quando a policy deixa ler: o operador não tem
  // clientes.read e veria "não vinculado" num cliente que existe.
  const cliente = os?.clientes?.nome ?? arte.clientes?.nome ?? null;
  // "Sem cliente" só quando dá para afirmar: OS lida e sem cliente_id.
  const semCliente = arte.os_id ? (os ? !os.cliente_id : false) : !arte.cliente_id;

  return (
    <Card className="overflow-hidden">
      <MiniaturaDaArte arte={arte} onVista={onVista} />
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base min-w-0">
            {arte.os_id && os?.numero != null ? (
              <Link to="/os/$id" params={{ id: arte.os_id }} className="hover:underline">
                OS {os.numero}
              </Link>
            ) : (
              <span className="block truncate" title={arte.nome}>
                {arte.nome}
              </span>
            )}
          </CardTitle>
          <Badge variant="outline">v{arte.versao}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {arte.os_id ? (
            <StatusChip label={situacao.rotulo} tone={situacao.tom} />
          ) : (
            <StatusChip label="Arte de orçamento" tone="muted" />
          )}
          {os?.status && (
            <span className="text-xs text-muted-foreground">OS em: {rotuloDe(os.status)}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {os?.titulo && (
            <div className="truncate" title={os.titulo}>
              {os.titulo}
            </div>
          )}
          {cliente ? (
            <div>Cliente: {cliente}</div>
          ) : semCliente ? (
            <div>Sem cliente vinculado</div>
          ) : null}
          {/* O nome do designer só vem para admin e gestor (policy de
              `usuarios`). Sem o nome, só se afirma "não definido" quando a OS
              de fato não tem designer. */}
          {os && (os.usuarios?.nome || !os.designer_id) && (
            <div>Designer: {os.usuarios?.nome ?? "não definido na OS"}</div>
          )}
          <div>Enviada: {formatDateTime(arte.created_at)}</div>
          {ultima?.decisao === "solicitada" && (
            <div>Link de aprovação enviado ao cliente em {formatDateTime(ultima.created_at)}</div>
          )}
        </div>

        {ajuste && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
            <span className="font-medium">Ajuste pedido:</span> {ajuste}
          </p>
        )}

        {!arte.os_id && (
          <p className="text-xs text-muted-foreground">
            Ainda não virou OS: a aprovação fica disponível quando o orçamento for convertido.
            {orcamentoId && pode.verOrcamento && (
              <>
                {" "}
                <Link
                  to="/orcamentos/$id"
                  params={{ id: orcamentoId }}
                  className="text-primary hover:underline"
                >
                  Abrir o orçamento
                </Link>
              </>
            )}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {arte.os_id && pode.decidir && (
            <DecisaoDaArte
              arte={{
                id: arte.id,
                nome: arte.nome,
                versao: arte.versao,
                os_id: arte.os_id,
                os_numero: os?.numero ?? null,
                os_status: os?.status ?? null,
                status: arte.status,
              }}
              vista={vista}
            />
          )}
          {arte.os_id && pode.pedirAoCliente && arte.status !== "aprovado" && (
            <EnviarParaAprovacao
              arquivoId={arte.id}
              arquivoNome={arte.nome}
              osNumero={os?.numero ?? null}
              telefoneCliente={os?.clientes?.telefone ?? null}
              // Gerar o link põe a OS em "aguardando aprovação de arte" e
              // grava a solicitação: o cartão relê para mostrar as duas coisas.
              onGerado={() => void qc.invalidateQueries({ queryKey: ["design-fila"] })}
            />
          )}
          <ComentariosDaArte arquivoId={arte.id} nome={arte.nome} total={comentarios} />
          {arte.os_id && pode.concluir && <ConcluirArte arte={arte} />}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Concluir = marcar como arquivo FINAL de produção, e a arte sai da fila.
 *
 * Só este botão conclui — e diz que conclui. Arte ainda não aprovada pede
 * confirmação: concluir não aprova, e a OS continua barrada para produção até
 * a aprovação ser registrada.
 */
function ConcluirArte({ arte }: { arte: ArteDaFila }) {
  const qc = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);
  const aprovada = arte.status === "aprovado";

  const concluir = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any)
        .from("arquivos")
        .update({ final_producao: true })
        .eq("id", arte.id)
        .select("id");
      if (error) throw error;
      // A policy de UPDATE barra em silêncio (0 linhas, sem erro).
      if (!data || data.length === 0) {
        throw new Error(
          "Nada foi alterado: seu perfil não pode marcar o arquivo final (arquivos.finalize).",
        );
      }
    },
    onSuccess: () => {
      toast.success("Arte concluída: marcada como arquivo final de produção.");
      setConfirmar(false);
      qc.invalidateQueries({ queryKey: ["design-fila"] });
      if (arte.os_id) qc.invalidateQueries({ queryKey: ["arquivos-os", arte.os_id] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={concluir.isPending}
        title="Marcar como arquivo final de produção e tirar da fila do design"
        onClick={() => (aprovada ? concluir.mutate() : setConfirmar(true))}
      >
        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Concluir
      </Button>
      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Concluir sem aprovação?</AlertDialogTitle>
            <AlertDialogDescription>
              Concluir marca “{arte.nome}” como o arquivo final de produção e tira da fila do
              design. Ela ainda não foi aprovada: concluir não aprova, e a OS continua barrada para
              produção até alguém registrar a aprovação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => concluir.mutate()}>
              Concluir assim mesmo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
