import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";

/**
 * "O cliente aprovou", num gesto só (31/10/2026).
 *
 * "Arte aprovada" era um status que qualquer um escolhia, mas a trava de produção
 * lê OUTRO registro, o aceite: a OS 165 e a 168 estavam no status e o cartão dizia
 * "Arte ainda não aprovada". Aqui quem recebeu o aceite (WhatsApp, telefone, balcão,
 * e-mail) registra por onde veio, e o banco grava o aceite e leva a OS para "Arte
 * aprovada" no mesmo passo. Não precisa de arquivo na OS: a arte pode ter vindo pelo
 * WhatsApp. Quem pode chamar é decidido pela função (os.update), não por esta tela.
 */
export const CANAIS_DO_ACEITE = [
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "telefone", rotulo: "Telefone" },
  { valor: "presencial", rotulo: "No balcão" },
  { valor: "email", rotulo: "E-mail" },
] as const;

export function AceiteDaArteRapido({
  osId,
  aberto,
  onAbertoChange,
}: {
  osId: string;
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
}) {
  const qc = useQueryClient();
  const [canal, setCanal] = useState<string>("whatsapp");
  const [observacao, setObservacao] = useState("");

  const registrar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("registrar_aceite_da_arte", {
        p_os_id: osId,
        p_canal: canal,
        p_observacao: observacao.trim() || null,
      });
      if (error) throw error;
      return data as { ja_aceita?: boolean; status?: string } | null;
    },
    onSuccess: (resposta) => {
      if (resposta?.ja_aceita) {
        toast.info("O aceite desta OS já estava registrado.");
      } else {
        toast.success("Aceite registrado.", {
          description: resposta?.status === "arte_aprovada" ? "A OS foi para “Arte aprovada”." : undefined,
        });
      }
      setObservacao("");
      onAbertoChange(false);
      for (const chave of [["kanban-os"], ["kanban-bloqueios"], ["os", osId], ["arquivos-os", osId], ["design-fila"]]) {
        void qc.invalidateQueries({ queryKey: chave });
      }
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  if (!aberto) {
    return (
      <Button type="button" size="sm" onClick={() => onAbertoChange(true)}>
        <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        O cliente aprovou
      </Button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-border bg-background/60 p-3">
      <p className="text-xs font-medium text-foreground">Como o cliente aprovou?</p>
      <div role="radiogroup" aria-label="Como o cliente aprovou" className="flex flex-wrap gap-1.5">
        {CANAIS_DO_ACEITE.map((c) => (
          <label
            key={c.valor}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-colors focus-within:ring-1 focus-within:ring-[color:var(--bex-cyan)]",
              canal === c.valor
                ? "border-[color:var(--bex-cyan)]/60 bg-[color:var(--bex-cyan)]/15 font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-foreground/30",
            )}
          >
            <input
              type="radio"
              name={`canal-do-aceite-${osId}`}
              value={c.valor}
              checked={canal === c.valor}
              onChange={() => setCanal(c.valor)}
              className="sr-only"
            />
            {c.rotulo}
          </label>
        ))}
      </div>
      <Input
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        maxLength={200}
        aria-label="Observação do aceite"
        placeholder="Observação, se quiser. Ex.: aprovou a versão 2"
        className="h-9 text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={registrar.isPending} onClick={() => registrar.mutate()}>
          {registrar.isPending ? "Registrando…" : "Registrar aceite"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={registrar.isPending} onClick={() => onAbertoChange(false)}>
          Cancelar
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Fica registrado quem, quando e por onde.</p>
    </div>
  );
}
