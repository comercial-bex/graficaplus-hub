/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import {
  CATALOGO,
  ESPERAS,
  GATILHOS,
  INTERVALOS,
  infoDoGatilho,
  rotuloDeDuracao,
  type Gatilho,
} from "@/domain/automacoes/catalogo";
import {
  mesmoAlvo,
  validarAutomacao,
  type CampoForm,
  type FormAutomacao,
} from "@/domain/automacoes/formulario";
import { dadosDeExemplo, renderizarMensagem } from "@/domain/automacoes/mensagem";
import { fluxo } from "@/domain/os/etapas";

/** Lista de opções com o valor gravado, mesmo que ele não esteja entre as de sempre. */
function comAtual(opcoes: { segundos: number; rotulo: string }[], atual: number) {
  if (opcoes.some((o) => o.segundos === atual)) return opcoes;
  return [...opcoes, { segundos: atual, rotulo: `${rotuloDeDuracao(atual)} (gravado antes)` }];
}

/**
 * Criar e editar automação.
 *
 * Tudo o que aparece aqui vem de `domain/automacoes/catalogo.ts` — o que o motor
 * vivo executa. Não há campo de "ação" porque só existe uma (WhatsApp), nem de
 * condição livre porque `automacao_condicao_ok` só lê três chaves.
 */
export function AutomacaoDialog({
  aberto,
  onAbertoChange,
  inicial,
  automacaoId,
  envioFunciona,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  inicial: FormAutomacao;
  /** Com id, edita; sem, cria. */
  automacaoId?: string | null;
  /** WhatsApp conectado e fila andando: decide o aviso de "ligada sem enviar". */
  envioFunciona: boolean;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState<FormAutomacao>(inicial);
  const [tentou, setTentou] = useState(false);

  // Cada abertura começa do que veio de fora (modelo, linha a editar ou vazio).
  useEffect(() => {
    if (aberto) {
      setForm(inicial);
      setTentou(false);
    }
  }, [aberto, inicial]);

  const info = infoDoGatilho(form.gatilho);
  const validacao = useMemo(() => validarAutomacao(form), [form]);
  const erros: Partial<Record<CampoForm, string>> = !validacao.ok && tentou ? validacao.erros : {};

  const previa = useMemo(() => {
    if (!info || !form.mensagem.trim()) return "";
    return renderizarMensagem(form.mensagem, dadosDeExemplo(info.variaveis));
  }, [info, form.mensagem]);

  // Estoque mínimo dispara por material: dizer quantos já estão no mínimo
  // é dizer quantas mensagens a automação manda no primeiro dia.
  const noMinimo = useQuery({
    queryKey: ["automacao-materiais-no-minimo"],
    enabled: aberto && form.gatilho === "estoque_minimo",
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("materiais_operacional")
        .select("estoque, estoque_minimo");
      if (error) throw error;
      return (data ?? []) as { estoque: number | null; estoque_minimo: number | null }[];
    },
  });
  const limiteEstoque =
    form.estoqueMinimo.trim() === "" ? null : Number(form.estoqueMinimo.replace(",", "."));
  const quantosNoMinimo = (noMinimo.data ?? []).filter((m) => {
    const minimo = limiteEstoque ?? Number(m.estoque_minimo ?? 10);
    return m.estoque != null && Number(m.estoque) <= minimo;
  }).length;

  const salvar = useMutation({
    mutationFn: async () => {
      if (!validacao.ok) throw new Error("Corrija os campos marcados.");
      const registro = validacao.registro;
      if (automacaoId) {
        // Escrita barrada por RLS volta com 0 linhas e sem erro: sem conferir,
        // a tela diria "salvo" com a automação antiga no ar.
        const { data, error } = await (supabase as any)
          .from("automacoes")
          .update(registro)
          .eq("id", automacaoId)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error(
            "Nada foi alterado: seu perfil não tem permissão para editar automações (automacoes.manage).",
          );
        }
      } else {
        const { error } = await (supabase as any)
          .from("automacoes")
          .insert({ ...registro, created_by: user?.id ?? null })
          .select("id")
          .single();
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(automacaoId ? "Automação atualizada" : "Automação criada");
      qc.invalidateQueries({ queryKey: ["automacoes"] });
      qc.invalidateQueries({ queryKey: ["automacao_execucoes"] });
      onAbertoChange(false);
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  function trocarGatilho(g: Gatilho) {
    const novo = CATALOGO[g];
    setForm((f) => ({
      ...f,
      gatilho: g,
      // Evento sem cliente não pode ficar com destino "cliente"; o lembrete à
      // gerência já nasce mandando para os gestores do cadastro.
      destino: novo.paraGestores
        ? "gestores"
        : f.destino === "gestores" || (f.destino === "cliente" && !novo.aceitaCliente)
          ? "fixo"
          : f.destino,
      // Situação que dura pede intervalo longo; acontecimento, o padrão do banco.
      intervaloSegundos: novo.situacao ? Math.max(f.intervaloSegundos, 86400) : f.intervaloSegundos,
      etapas: novo.condicao === "status" ? f.etapas : [],
    }));
  }

  function alternarEtapa(status: string, marcar: boolean) {
    setForm((f) => ({
      ...f,
      etapas: marcar ? [...new Set([...f.etapas, status])] : f.etapas.filter((s) => s !== status),
    }));
  }

  function inserirVariavel(chave: string) {
    setForm((f) => ({
      ...f,
      mensagem: `${f.mensagem}${f.mensagem && !f.mensagem.endsWith(" ") ? " " : ""}{{${chave}}}`,
    }));
  }

  const alvo = mesmoAlvo(info?.alvo);

  return (
    <Dialog open={aberto} onOpenChange={onAbertoChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{automacaoId ? "Editar automação" : "Nova automação"}</DialogTitle>
          <DialogDescription>
            Quando algo acontece no sistema, uma mensagem de WhatsApp sai sozinha. Só aparecem aqui
            os eventos e condições que o motor executa de verdade.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="auto-nome">Nome</Label>
            <Input
              id="auto-nome"
              value={form.nome}
              maxLength={80}
              placeholder="Ex.: OS atrasada — avisar a equipe"
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
            {erros.nome && <p className="text-xs text-destructive">{erros.nome}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Quando</Label>
            <Select
              value={form.gatilho || undefined}
              onValueChange={(v) => trocarGatilho(v as Gatilho)}
            >
              <SelectTrigger aria-label="Quando a automação dispara">
                <SelectValue placeholder="Escolha o evento" />
              </SelectTrigger>
              <SelectContent>
                {GATILHOS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {CATALOGO[g].rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {info && <p className="text-xs text-muted-foreground">{info.quando}</p>}
            {erros.gatilho && <p className="text-xs text-destructive">{erros.gatilho}</p>}
          </div>

          {info?.condicao === "status" && (
            <div className="space-y-1.5">
              <Label>Em quais etapas</Label>
              <p className="text-xs text-muted-foreground">
                A mensagem sai quando a OS ENTRA numa destas etapas. Sem nenhuma marcada, vale
                qualquer mudança.
              </p>
              <div className="max-h-56 overflow-y-auto rounded-md border p-3 space-y-3">
                {fluxo().map((grupo) => (
                  <div key={grupo.etapa}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      {grupo.rotulo}
                    </p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {grupo.status.map((s) => {
                        const id = `etapa-${s.status}`;
                        return (
                          <label
                            key={s.status}
                            htmlFor={id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Checkbox
                              id={id}
                              checked={form.etapas.includes(s.status)}
                              onCheckedChange={(v) => alternarEtapa(s.status, v === true)}
                            />
                            {s.rotulo}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {erros.etapas && <p className="text-xs text-destructive">{erros.etapas}</p>}
            </div>
          )}

          {info?.condicao === "estoque_minimo" && (
            <div className="space-y-1.5">
              <Label htmlFor="auto-estoque">Avisar quando o estoque chegar a</Label>
              <Input
                id="auto-estoque"
                inputMode="decimal"
                className="w-40"
                placeholder="mínimo de cada um"
                value={form.estoqueMinimo}
                onChange={(e) => setForm({ ...form, estoqueMinimo: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Em branco, usa o estoque mínimo cadastrado em cada material.
              </p>
              {noMinimo.isError ? (
                <p className="text-xs text-destructive">
                  Não deu para contar os materiais: {mensagemErro(noMinimo.error)}
                </p>
              ) : noMinimo.data ? (
                <p
                  className={`text-xs ${quantosNoMinimo > 0 ? "text-amber-600" : "text-muted-foreground"}`}
                >
                  Hoje {quantosNoMinimo} de {noMinimo.data.length} materiais já estão nesse ponto.
                  Ligada, cada um vira uma mensagem — e ela se repete a cada{" "}
                  {rotuloDeDuracao(form.intervaloSegundos)} enquanto o material não for reposto.
                </p>
              ) : null}
              {erros.estoqueMinimo && (
                <p className="text-xs text-destructive">{erros.estoqueMinimo}</p>
              )}
            </div>
          )}

          {info?.condicao === "margem_minima" && (
            <div className="space-y-1.5">
              <Label htmlFor="auto-margem">Avisar quando a margem real ficar abaixo de (%)</Label>
              <Input
                id="auto-margem"
                inputMode="decimal"
                className="w-32"
                value={form.margemMinima}
                onChange={(e) => setForm({ ...form, margemMinima: e.target.value })}
              />
              {erros.margemMinima && (
                <p className="text-xs text-destructive">{erros.margemMinima}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Para quem</Label>
            <RadioGroup
              value={form.destino}
              onValueChange={(v) => setForm({ ...form, destino: v as FormAutomacao["destino"] })}
              className="gap-2"
            >
              {info?.paraGestores && (
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="gestores" id="destino-gestores" />
                  Os gestores (o telefone de cada um no cadastro de Usuários)
                </label>
              )}
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="fixo" id="destino-fixo" />
                Um número da equipe
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${info && !info.aceitaCliente ? "opacity-50" : ""}`}
              >
                <RadioGroupItem
                  value="cliente"
                  id="destino-cliente"
                  disabled={!!info && !info.aceitaCliente}
                />
                O cliente da OS (telefone do cadastro)
              </label>
            </RadioGroup>
            {info && !info.aceitaCliente && (
              <p className="text-xs text-muted-foreground">
                Este evento avisa só a equipe:{" "}
                {info.gatilho === "estoque_minimo"
                  ? "material não tem cliente."
                  : info.paraGestores
                    ? "é assunto da gerência."
                    : "é assunto de dinheiro."}
              </p>
            )}
            {form.destino === "fixo" && (
              <Input
                aria-label="Celular que recebe a mensagem"
                inputMode="tel"
                className="w-56"
                placeholder="(96) 99111-6169"
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              />
            )}
            {erros.destino && <p className="text-xs text-destructive">{erros.destino}</p>}
            {erros.telefone && <p className="text-xs text-destructive">{erros.telefone}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-mensagem">Mensagem</Label>
            <Textarea
              id="auto-mensagem"
              rows={3}
              maxLength={1000}
              value={form.mensagem}
              onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
              placeholder={
                info
                  ? "Escreva a mensagem. Clique numa variável para inserir."
                  : "Escolha o evento primeiro"
              }
            />
            {info && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">Variáveis:</span>
                {info.variaveis.map((v) => (
                  <button
                    key={v.chave}
                    type="button"
                    title={v.rotulo}
                    onClick={() => inserirVariavel(v.chave)}
                    className={cn(
                      badgeVariants({ variant: "outline" }),
                      "font-mono text-[10px] font-normal cursor-pointer",
                    )}
                  >
                    {`{{${v.chave}}}`}
                  </button>
                ))}
              </div>
            )}
            {previa && (
              <div className="rounded-md border bg-muted/40 p-2 text-sm">
                <span className="text-xs text-muted-foreground">Prévia com dados de exemplo: </span>
                {previa}
              </div>
            )}
            {erros.mensagem && <p className="text-xs text-destructive">{erros.mensagem}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Não repetir para {alvo} antes de</Label>
              <Select
                value={String(form.intervaloSegundos)}
                onValueChange={(v) => setForm({ ...form, intervaloSegundos: Number(v) })}
              >
                <SelectTrigger aria-label="Intervalo mínimo entre dois avisos">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {comAtual(INTERVALOS, form.intervaloSegundos).map((o) => (
                    <SelectItem key={o.segundos} value={String(o.segundos)}>
                      {o.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {erros.intervaloSegundos && (
                <p className="text-xs text-destructive">{erros.intervaloSegundos}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Enviar</Label>
              <Select
                value={String(form.esperaSegundos)}
                onValueChange={(v) => setForm({ ...form, esperaSegundos: Number(v) })}
              >
                <SelectTrigger aria-label="Quanto esperar antes de enviar">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {comAtual(ESPERAS, form.esperaSegundos).map((o) => (
                    <SelectItem key={o.segundos} value={String(o.segundos)}>
                      {o.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {erros.esperaSegundos && (
                <p className="text-xs text-destructive">{erros.esperaSegundos}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                aria-label="Automação ligada"
              />
              {form.ativo ? "Ligada" : "Desligada"}
            </label>
            {form.ativo && !envioFunciona && (
              <p className="flex gap-2 text-xs text-amber-600">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                Ligada agora, ela só enfileira: o WhatsApp ou o processador da fila não estão
                funcionando (veja no alto da tela). Quando voltarem, tudo o que estiver na fila sai
                de uma vez.
              </p>
            )}
          </div>

          {validacao.avisos.length > 0 && (
            <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              {validacao.avisos.map((a) => (
                <p key={a} className="flex gap-2">
                  <AlertTriangle
                    className="h-3.5 w-3.5 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                  {a}
                </p>
              ))}
            </div>
          )}

          {automacaoId && (
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Mensagens que já estão na fila saem com o texto de quando entraram. Desligar cancela
              as que ainda não saíram.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onAbertoChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={salvar.isPending}
            onClick={() => {
              setTentou(true);
              if (!validacao.ok) {
                toast.error("Corrija os campos marcados antes de salvar.");
                return;
              }
              salvar.mutate();
            }}
          >
            {salvar.isPending ? "Salvando…" : automacaoId ? "Salvar alterações" : "Criar automação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
