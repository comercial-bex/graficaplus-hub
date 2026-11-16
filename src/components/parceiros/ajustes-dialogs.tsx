/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mensagemErro } from "@/lib/erros";
import { ajustarCredito, type ResumoDoParceiro } from "@/lib/parceiro-api";
import { brl } from "@/domain/parceiros/preco";
import { useEquipe, useNiveis } from "./dados";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { Checkbox } from "@/components/ui/checkbox";
import { detalhesValidacao, validarParceiro, preferenciaAvisos } from "@/lib/parceiro-avisos-api";
import { eContaDeTeste, marcarContaDeTeste } from "@/lib/parceiro-atendimento-api";
import { useAuth } from "@/lib/auth-context";

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
          <DialogDescription>
            Saldo atual: {brl(parceiro.saldo_credito)}. O ajuste aparece no extrato do parceiro.
          </DialogDescription>
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
          <Label htmlFor="credito-motivo" className="flex items-center gap-1">
            Motivo (o parceiro vê)
            <DicaIcone texto={dicaCampo("/parceiros", "motivo")} rotulo="Motivo" />
          </Label>
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
  const [nota, setNota] = useState("");
  const detalhes = useQuery({
    queryKey: ["parceiro-validacao", parceiro?.id],
    enabled: !!parceiro,
    queryFn: () => (parceiro ? detalhesValidacao(parceiro.id) : Promise.resolve(null)),
  });
  const { hasPermission } = useAuth();
  const podeGerir = hasPermission("parceiros.manage");
  const teste = useQuery({
    queryKey: ["parceiro-teste", parceiro?.id],
    enabled: !!parceiro && podeGerir,
    queryFn: () => (parceiro ? eContaDeTeste(parceiro.id) : Promise.resolve(null)),
  });

  async function mudarTeste(v: boolean) {
    if (!parceiro) return;
    setSalvando(true);
    try {
      await marcarContaDeTeste(parceiro.id, v);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["parceiro-teste"] }),
        qc.invalidateQueries({ queryKey: ["parceiros-sem-contato"] }),
        qc.invalidateQueries({ queryKey: ["parceiro-aviso-publico"] }),
      ]);
      toast.success(v ? "Marcado como conta de teste." : "Deixou de ser conta de teste.");
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  async function registrarValidacao() {
    if (!parceiro) return;
    setSalvando(true);
    try {
      await validarParceiro(parceiro.id, nota);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["parceiro-validacao"] }),
        qc.invalidateQueries({ queryKey: ["parceiros-ramo"] }),
      ]);
      toast.success("Validação registrada.");
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  async function mudarAvisos(sair: boolean) {
    if (!parceiro) return;
    setSalvando(true);
    try {
      await preferenciaAvisos(parceiro.id, sair);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["parceiro-validacao"] }),
        qc.invalidateQueries({ queryKey: ["parceiro-aviso-publico"] }),
      ]);
      toast.success(
        sair ? "Parceiro retirado dos próximos avisos." : "Parceiro pode receber avisos.",
      );
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  useEffect(() => {
    if (!parceiro) return;
    setCarregado(false);
    setNota("");
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
          <DialogDescription>
            Quem atende, o nível garantido e se o painel está liberado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <section className="space-y-2 border-b border-border pb-3">
            <p className="font-medium">Conferência do parceiro</p>
            {detalhes.error && (
              <p className="text-sm text-destructive">{mensagemErro(detalhes.error)}</p>
            )}
            {detalhes.data?.comprovacao_url &&
              (/^https?:\/\//i.test(detalhes.data.comprovacao_url) ? (
                <a
                  className="break-all text-sm text-link underline"
                  href={detalhes.data.comprovacao_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {detalhes.data.comprovacao_url}
                </a>
              ) : (
                <p className="break-all text-sm">{detalhes.data.comprovacao_url}</p>
              ))}
            {detalhes.data?.validado_em && (
              <p className="text-sm text-muted-foreground">
                Validado em {new Date(detalhes.data.validado_em).toLocaleString("pt-BR")} ·{" "}
                {detalhes.data.validacao_nota}
              </p>
            )}
            <Label htmlFor="parceiro-validacao-nota">O que foi conferido</Label>
            <Input
              id="parceiro-validacao-nota"
              value={nota}
              maxLength={1000}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Instagram conferido"
              disabled={!detalhes.data}
            />
            <Button
              variant="outline"
              onClick={registrarValidacao}
              disabled={!detalhes.data || !nota.trim() || salvando}
            >
              Validar
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!detalhes.data?.nao_receber_avisos_em}
                disabled={!detalhes.data || salvando}
                onCheckedChange={(v) => mudarAvisos(v === true)}
              />
              Não receber avisos
            </label>
            {podeGerir && typeof teste.data === "boolean" && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={teste.data}
                  disabled={salvando}
                  onCheckedChange={(v) => mudarTeste(v === true)}
                />
                Conta de teste
                <span className="text-xs text-muted-foreground">
                  (fora dos avisos, dos lembretes e da lista de atendimento)
                </span>
              </label>
            )}
            {detalhes.data === null && (
              <p className="text-xs text-muted-foreground">
                Validação e preferência de avisos aguardam ativação autorizada.
              </p>
            )}
          </section>
          <div className="space-y-1.5">
            <Label>Atendente na gráfica</Label>
            <Select value={responsavel} onValueChange={setResponsavel} disabled={!carregado}>
              <SelectTrigger aria-label="Sem atendente">
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
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as ResumoDoParceiro["status"])}
              disabled={!carregado}
            >
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
                Sem acesso, o parceiro não abre o painel. O histórico e o crédito continuam
                guardados.
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
