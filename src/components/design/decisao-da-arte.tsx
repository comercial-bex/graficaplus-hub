/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mensagemErro } from "@/lib/erros";
import { rotuloDe } from "@/domain/os/etapas";
import { decisaoRecuaAOs } from "./tipo-de-arquivo";

type Decisao = "aprovado" | "ajuste";

/** Os canais que `registrar_aprovacao_interna` aceita, ditos como acontecem. */
const CANAIS: { valor: string; rotulo: string }[] = [
  { valor: "sistema", rotulo: "Decisão da equipe, aqui no sistema" },
  { valor: "whatsapp", rotulo: "O cliente respondeu pelo WhatsApp" },
  { valor: "telefone", rotulo: "O cliente respondeu por telefone" },
  { valor: "email", rotulo: "O cliente respondeu por e-mail" },
  { valor: "presencial", rotulo: "O cliente respondeu no balcão" },
];

export type ArteParaDecidir = {
  id: string;
  nome: string;
  versao: number;
  os_id: string;
  os_numero: number | null;
  os_status: string | null;
  status: string;
};

/**
 * Aprovar ou pedir ajuste — pelo caminho que já existe.
 *
 * Antes a fila gravava direto em `aprovacoes` com observação fixa. Isso não
 * escrevia o histórico da peça (`arquivo_aprovacoes`) nem mexia no status da
 * OS: a arte "aprovada" na fila deixava a OS parada em "aguardando aprovação".
 * Agora é `registrar_aprovacao_interna`, a mesma função da ficha da OS: grava
 * nas duas tabelas, muda o status do arquivo e o da OS. Quem pode chamar quem
 * decide é a função (os.update), não esta tela.
 *
 * "Aprovar" só libera depois de a pessoa VER a peça (`vista`): a miniatura
 * carregou ou o arquivo foi aberto.
 */
export function DecisaoDaArte({ arte, vista }: { arte: ArteParaDecidir; vista: boolean }) {
  const qc = useQueryClient();
  const [decisao, setDecisao] = useState<Decisao | null>(null);
  const [canal, setCanal] = useState("sistema");
  const [observacao, setObservacao] = useState("");

  const recua = decisaoRecuaAOs(arte.os_status);
  const curta = decisao === "ajuste" && observacao.trim().length < 3;

  const registrar = useMutation({
    mutationFn: async (d: Decisao) => {
      // A função recusa ajuste sem descrição, mas com mensagem sem acento — que
      // a tela traduziria para "Não foi possível concluir a operação". O
      // botão já fica travado antes; isto é só a última porta.
      if (d === "ajuste" && observacao.trim().length < 3) {
        throw new Error("Descreva o ajuste: sem isso o design não sabe o que corrigir.");
      }
      const { error } = await (supabase.rpc as any)("registrar_aprovacao_interna", {
        p_os_id: arte.os_id,
        p_arquivo_id: arte.id,
        p_decisao: d,
        p_canal: canal,
        p_cliente_contato_id: null,
        p_observacao:
          observacao.trim() || (d === "aprovado" ? "Aprovada pela fila de Design & Arte" : null),
      });
      if (error) throw error;
      return d;
    },
    onSuccess: (d) => {
      toast.success(
        d === "aprovado"
          ? `Arte aprovada. A OS ${arte.os_numero ?? ""} foi para “Arte aprovada”.`
          : `Ajuste registrado. A OS ${arte.os_numero ?? ""} foi para “Arte rejeitada” e a arte volta para o design.`,
      );
      setDecisao(null);
      setObservacao("");
      setCanal("sistema");
      qc.invalidateQueries({ queryKey: ["design-fila"] });
      qc.invalidateQueries({ queryKey: ["arquivos-os", arte.os_id] });
      qc.invalidateQueries({ queryKey: ["os", arte.os_id] });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      {arte.status !== "aprovado" && (
        <Button
          size="sm"
          className="flex-1"
          disabled={!vista}
          title={
            vista
              ? "Registrar a aprovação desta arte"
              : "Abra a arte antes de aprovar — este arquivo não tem miniatura"
          }
          onClick={() => setDecisao("aprovado")}
        >
          <Check className="h-3.5 w-3.5 mr-1" /> Aprovar
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setDecisao("ajuste")}>
        <PencilLine className="h-3.5 w-3.5 mr-1" /> Pedir ajuste
      </Button>

      <Dialog open={decisao !== null} onOpenChange={(v) => !v && setDecisao(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisao === "aprovado" ? "Aprovar a arte" : "Pedir ajuste na arte"}
            </DialogTitle>
            <DialogDescription>
              OS {arte.os_numero ?? "—"} · {arte.nome} · v{arte.versao}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {recua && (
              <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />A OS
                está em “{rotuloDe(arte.os_status)}”. Registrar esta decisão volta a OS para “
                {decisao === "aprovado" ? "Arte aprovada" : "Arte rejeitada"}”.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Como foi a decisão</Label>
              <Select value={canal} onValueChange={setCanal}>
                <SelectTrigger aria-label="Canal da decisão">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CANAIS.map((c) => (
                    <SelectItem key={c.valor} value={c.valor}>
                      {c.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`obs-${arte.id}`}>
                {decisao === "ajuste" ? "O que precisa mudar?" : "Observação (opcional)"}
              </Label>
              <Textarea
                id={`obs-${arte.id}`}
                rows={3}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder={
                  decisao === "ajuste"
                    ? "Ex.: o telefone está errado, o certo é (96) 99111-6169. E o logo precisa ficar maior."
                    : "Ex.: aprovado pelo dono por telefone às 10h."
                }
              />
              {curta && (
                <p className="text-xs text-muted-foreground">
                  Descreva o ajuste (pelo menos 3 letras): sem isso o design não sabe o que
                  corrigir.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDecisao(null)}>
              Cancelar
            </Button>
            <Button
              disabled={registrar.isPending || curta}
              variant={decisao === "ajuste" ? "secondary" : "default"}
              onClick={() => decisao && registrar.mutate(decisao)}
            >
              {registrar.isPending
                ? "Registrando…"
                : decisao === "aprovado"
                  ? "Registrar aprovação"
                  : "Registrar pedido de ajuste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
