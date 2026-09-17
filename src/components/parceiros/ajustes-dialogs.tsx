/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mensagemErro } from "@/lib/erros";
import { ajustarCredito, type ResumoDoParceiro } from "@/lib/parceiro-api";
import { brl } from "@/domain/parceiros/preco";
import { useEquipe, useNiveis } from "./dados";

/** Crédito manual: bonificação combinada fora das metas, ou correção. Sempre com motivo. */
export function CreditoDialog({
  parceiro,
  onOpenChange,
}: {
  parceiro: ResumoDoParceiro | null;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [sinal, setSinal] = useState<"mais" | "menos">("mais");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (parceiro) {
      setSinal("mais");
      setValor("");
      setMotivo("");
    }
  }, [parceiro]);

  if (!parceiro) return null;
  const numero = Number(valor.replace(",", "."));

  async function salvar() {
    if (!parceiro) return;
    setSalvando(true);
    try {
      await ajustarCredito(parceiro.id, sinal === "mais" ? numero : -numero, motivo);
      toast.success("Crédito ajustado");
      qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível ajustar o crédito."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!parceiro} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Crédito · {parceiro.nome}</DialogTitle>
          <DialogDescription>Saldo atual: {brl(parceiro.saldo_credito)}. O ajuste aparece no extrato do parceiro.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Select value={sinal} onValueChange={(v) => setSinal(v as "mais" | "menos")}>
            <SelectTrigger className="w-32" aria-label="Tipo do ajuste">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mais">Dar crédito</SelectItem>
              <SelectItem value="menos">Tirar crédito</SelectItem>
            </SelectContent>
          </Select>
          <Input
            inputMode="decimal"
            placeholder="Valor em R$"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            aria-label="Valor do ajuste"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="credito-motivo">Motivo (o parceiro vê)</Label>
          <Input
            id="credito-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: bônus de inauguração"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || !(numero > 0) || !motivo.trim()}>
            {salvando ? "Salvando…" : "Confirmar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Atendente, nível garantido e situação do parceiro. */
export function CadastroDialog({
  parceiro,
  onOpenChange,
}: {
  parceiro: ResumoDoParceiro | null;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: equipe = [] } = useEquipe();
  const { data: niveis = [] } = useNiveis();
  const [responsavel, setResponsavel] = useState("");
  const [nivel, setNivel] = useState("automatico");
  const [status, setStatus] = useState<ResumoDoParceiro["status"]>("ativo");
  const [carregado, setCarregado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!parceiro) return;
    setCarregado(false);
    (supabase as any)
      .from("parceiros")
      .select("responsavel_id, nivel_fixo_id, status")
      .eq("id", parceiro.id)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        setResponsavel(data?.responsavel_id ?? "");
        setNivel(data?.nivel_fixo_id ?? "automatico");
        setStatus(data?.status ?? parceiro.status);
        setCarregado(true);
      });
  }, [parceiro]);

  if (!parceiro) return null;

  async function salvar() {
    if (!parceiro) return;
    setSalvando(true);
    try {
      const { data, error } = await (supabase as any)
        .from("parceiros")
        .update({
          responsavel_id: responsavel || null,
          nivel_fixo_id: nivel === "automatico" ? null : nivel,
          status,
        })
        .eq("id", parceiro.id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Seu perfil não tem permissão para alterar parceiros.");
      toast.success("Cadastro do parceiro atualizado");
      qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!parceiro} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cadastro · {parceiro.nome}</DialogTitle>
          <DialogDescription>Quem atende, o nível garantido e se o painel está liberado.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Atendente na gráfica</Label>
            <Select value={responsavel} onValueChange={setResponsavel} disabled={!carregado}>
              <SelectTrigger>
                <SelectValue placeholder="Sem atendente" />
              </SelectTrigger>
              <SelectContent>
                {equipe.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome || p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Nível</Label>
            <Select value={nivel} onValueChange={setNivel} disabled={!carregado}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="automatico">Pelas compras (automático)</SelectItem>
                {niveis.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    Garantir no mínimo {n.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Situação</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ResumoDoParceiro["status"])} disabled={!carregado}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo — painel liberado</SelectItem>
                <SelectItem value="suspenso">Suspenso — painel bloqueado</SelectItem>
                <SelectItem value="encerrado">Encerrado</SelectItem>
              </SelectContent>
            </Select>
            {status !== "ativo" && (
              <p className="text-xs text-muted-foreground">
                Sem acesso, o parceiro não abre o painel. O histórico e o crédito continuam guardados.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || !carregado}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
