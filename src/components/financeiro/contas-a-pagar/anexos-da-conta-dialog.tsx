import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ExternalLink, FileText, ImageIcon, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Carregando } from "@/components/bex/Carregando";
import { mensagemErro } from "@/lib/erros";
import {
  BUCKET_DE_ANEXOS,
  ROTULO_DO_TIPO,
  frasesDoHistorico,
  pagaSemComprovante,
  tamanhoLegivel,
  temComprovanteAntigo,
  type AnexoDaConta,
  type LinhaDoHistorico,
  type TipoDeAnexo,
} from "@/domain/financeiro/contas-a-pagar-anexos";
import { CampoDeAnexos } from "./campo-de-anexos";
import {
  abrirArquivoPrivado,
  useEnviarAnexos,
  usePodeNaContaAPagar,
  useRemoverAnexo,
  type ArquivoParaEnviar,
} from "./use-conta-a-pagar";

export interface ContaDosAnexos {
  id: string;
  descricao: string;
  status: string;
  comprovante_url: string | null;
}

export type AbaDosAnexos = "anexos" | "historico";

const quando = (instante: string) =>
  new Date(instante).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Belem",
  });

/**
 * O clipe da conta: os arquivos (abrir, baixar, enviar, remover) e o histórico de quem fez o quê.
 * O comprovante antigo da parcela (bucket comprovantes, gravado pela baixa em Despesas fixas e
 * contratos) aparece aqui também, só para abrir: ele é gerido lá.
 */
export function AnexosDaContaDialog({
  conta,
  anexos,
  abaInicial,
  onFechar,
  onMudou,
}: {
  conta: ContaDosAnexos | null;
  anexos: readonly AnexoDaConta[];
  abaInicial: AbaDosAnexos;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const { podeAnexar, podeRemoverAnexo } = usePodeNaContaAPagar();
  const enviar = useEnviarAnexos();
  const remover = useRemoverAnexo();
  const [novos, setNovos] = useState<ArquivoParaEnviar[]>([]);
  const [aRemover, setARemover] = useState<AnexoDaConta | null>(null);
  const [motivoDaRemocao, setMotivoDaRemocao] = useState("");

  const historico = useQuery({
    queryKey: ["contas-pagar-historico", conta?.id],
    enabled: !!conta,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contas_pagar_historico")
        .select("id, evento, usuario_nome, ocorrido_em, valor, data_pagamento, motivo, detalhes")
        .eq("conta_pagar_id", conta!.id)
        .order("ocorrido_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LinhaDoHistorico[];
    },
  });

  const envio = useMutation({
    mutationFn: async () => enviar(conta!.id, novos),
    onSuccess: (r) => {
      if (r.enviados > 0)
        toast.success(r.enviados === 1 ? "Arquivo anexado" : `${r.enviados} arquivos anexados`);
      if (r.falhas.length > 0) toast.error(r.falhas.join(" "));
      setNovos([]);
      onMudou();
      void historico.refetch();
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const remocao = useMutation({
    mutationFn: async (a: AnexoDaConta) => remover(a.id, motivoDaRemocao),
    onSuccess: (r) => {
      if (r.arquivoApagado) toast.success("Anexo removido");
      else
        toast.warning(
          "Anexo removido da conta, mas o arquivo ficou no armazenamento. Avise o suporte.",
        );
      setARemover(null);
      setMotivoDaRemocao("");
      onMudou();
      void historico.refetch();
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  async function abrir(bucket: string, caminho: string, baixarComNome?: string) {
    const ok = await abrirArquivoPrivado(bucket, caminho, baixarComNome);
    if (!ok) toast.error("Não deu para abrir o arquivo. Tente de novo.");
  }

  const porTipo = (tipo: TipoDeAnexo) => anexos.filter((a) => a.tipo === tipo);
  const semComprovante = conta ? pagaSemComprovante(conta, anexos) : false;

  return (
    <Dialog open={!!conta} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Anexos e histórico</DialogTitle>
          <DialogDescription className="break-words">{conta?.descricao}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={abaInicial}>
          <TabsList>
            <TabsTrigger value="anexos">
              Anexos ({anexos.length + (conta && temComprovanteAntigo(conta) ? 1 : 0)})
            </TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="anexos" className="mt-4 space-y-5">
            {semComprovante && (
              <p className="text-sm text-status-amber">
                Conta paga sem comprovante. Anexe o comprovante de pagamento: é ele que prova o
                pagamento.
              </p>
            )}

            {(["fatura", "comprovante"] as const).map((tipo) => (
              <section key={tipo} aria-labelledby={`anexos-${tipo}`} className="space-y-2">
                <h3 id={`anexos-${tipo}`} className="text-sm font-semibold">
                  {ROTULO_DO_TIPO[tipo]}
                </h3>
                {porTipo(tipo).length === 0 &&
                !(tipo === "comprovante" && conta && temComprovanteAntigo(conta)) ? (
                  <p className="text-sm text-muted-foreground">Nenhum arquivo.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {tipo === "comprovante" && conta && temComprovanteAntigo(conta) && (
                      <li className="flex flex-wrap items-center gap-2 p-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 text-sm">
                          Comprovante da baixa da parcela
                          <span className="block text-xs text-muted-foreground">
                            Anexado em Despesas fixas e contratos
                          </span>
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-11 w-11"
                          aria-label="Abrir o comprovante da baixa da parcela"
                          onClick={() => void abrir("comprovantes", conta.comprovante_url!)}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </li>
                    )}
                    {porTipo(tipo).map((a) => {
                      const Icone = a.mime === "application/pdf" ? FileText : ImageIcon;
                      const confirmando = aRemover?.id === a.id;
                      return (
                        <li key={a.id} className="space-y-2 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="min-w-0 flex-1 text-sm">
                              <span className="block truncate">{a.nome_arquivo}</span>
                              <span className="block text-xs text-muted-foreground">
                                {tamanhoLegivel(Number(a.tamanho_bytes))} ·{" "}
                                {a.enviado_por_nome ?? "sem nome"} · {quando(a.enviado_em)}
                              </span>
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-11 w-11"
                              aria-label={`Abrir ${a.nome_arquivo}`}
                              onClick={() => void abrir(BUCKET_DE_ANEXOS, a.caminho)}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-11 w-11"
                              aria-label={`Baixar ${a.nome_arquivo}`}
                              onClick={() =>
                                void abrir(BUCKET_DE_ANEXOS, a.caminho, a.nome_arquivo)
                              }
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            {podeRemoverAnexo && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-11 w-11 text-destructive"
                                aria-label={`Remover ${a.nome_arquivo}`}
                                aria-expanded={confirmando}
                                onClick={() => {
                                  setARemover(confirmando ? null : a);
                                  setMotivoDaRemocao("");
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          {podeRemoverAnexo && confirmando && (
                            <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted p-2">
                              <div className="min-w-[200px] flex-1 space-y-1">
                                <Label htmlFor={`remover-${a.id}`} className="text-xs">
                                  Motivo da remoção (opcional, fica no histórico)
                                </Label>
                                <Input
                                  id={`remover-${a.id}`}
                                  value={motivoDaRemocao}
                                  onChange={(e) => setMotivoDaRemocao(e.target.value)}
                                  disabled={remocao.isPending}
                                />
                              </div>
                              <Button
                                variant="outline"
                                onClick={() => setARemover(null)}
                                disabled={remocao.isPending}
                              >
                                Cancelar
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={() => remocao.mutate(a)}
                                disabled={remocao.isPending}
                              >
                                {remocao.isPending ? "Removendo…" : "Remover arquivo"}
                              </Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}

            {podeAnexar && (
              <section
                aria-labelledby="anexos-enviar"
                className="space-y-2 border-t border-border pt-4"
              >
                <h3 id="anexos-enviar" className="text-sm font-semibold">
                  Anexar arquivos
                </h3>
                <CampoDeAnexos
                  id="anexos-novos"
                  itens={novos}
                  onChange={setNovos}
                  tipoPadrao={conta?.status === "paga" ? "comprovante" : "fatura"}
                  disabled={envio.isPending}
                />
                <Button
                  onClick={() => envio.mutate()}
                  disabled={novos.length === 0 || envio.isPending}
                >
                  {envio.isPending
                    ? "Enviando…"
                    : novos.length > 1
                      ? `Enviar ${novos.length} arquivos`
                      : "Enviar arquivo"}
                </Button>
              </section>
            )}
          </TabsContent>

          <TabsContent value="historico" className="mt-4">
            {historico.isLoading ? (
              <Carregando />
            ) : historico.error ? (
              <p className="text-sm text-destructive">Não deu para carregar o histórico.</p>
            ) : (historico.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sem registro. O histórico só existe a partir do dia em que foi ligado; o que
                aconteceu antes com esta conta não foi gravado.
              </p>
            ) : (
              <ol className="space-y-3">
                {(historico.data ?? []).map((h) => {
                  const f = frasesDoHistorico(h);
                  return (
                    <li key={h.id} className="border-l-2 border-border pl-3">
                      <div className="text-sm font-medium">{f.titulo}</div>
                      {f.detalhe && (
                        <div className="text-sm text-muted-foreground break-words">{f.detalhe}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {h.usuario_nome ?? "Sistema"} · {quando(h.ocorrido_em)}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
