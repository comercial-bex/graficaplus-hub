import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

/**
 * Os números que fazem o preço da máquina, editáveis onde a máquina mora.
 *
 * Sem esta tela, a tabela de velocidades e os modos de qualidade só existiriam
 * como semente de migração: se a estimativa estivesse errada — e a de
 * poliestireno está marcada como estimativa de propósito — ninguém na gráfica
 * teria como corrigir. Número que entra no preço e não pode ser corrigido por
 * quem conhece a máquina é número que vai ficar errado.
 *
 * O painel muda com a base de cobrança, porque as perguntas mudam:
 *   area   → modos de qualidade (mais passadas, menos m²/h)
 *   tempo  → velocidade por material e espessura, e o que a máquina NÃO corta
 *
 * Recorte e fiber não aparecem aqui: os parâmetros deles (mm/s e mínimo) são
 * campos únicos e já estão no formulário da máquina.
 */

const n = (t: string) => {
  const v = Number(String(t).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

function Painel({ titulo, ajuda, children }: { titulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <details className="rounded-md border bg-muted/30 p-2">
      <summary className="cursor-pointer text-xs font-medium">{titulo}</summary>
      <p className="mt-1 text-[11px] text-muted-foreground">{ajuda}</p>
      <div className="mt-2 space-y-1.5">{children}</div>
    </details>
  );
}

/* -------------------------------------------------------------------------- */
/* Modos de qualidade                                                          */
/* -------------------------------------------------------------------------- */

function Modos({ maquinaId }: { maquinaId: string }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [vel, setVel] = useState("");
  const [passadas, setPassadas] = useState("");

  const { data: modos = [] } = useQuery({
    queryKey: ["maquina-modos", maquinaId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("maquinas_modos_impressao")
        .select("id, nome, velocidade_m2_h, passadas, padrao, ordem")
        .eq("maquina_id", maquinaId)
        .order("ordem");
      return (data ?? []) as any[];
    },
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["maquina-modos", maquinaId] });
    qc.invalidateQueries({ queryKey: ["calc-modos"] });
  };

  const salvar = useMutation({
    mutationFn: async (linha: { id?: string; nome: string; velocidade_m2_h: number; passadas: number | null }) => {
      if (linha.id) {
        const { error } = await (supabase as any)
          .from("maquinas_modos_impressao")
          .update({ velocidade_m2_h: linha.velocidade_m2_h, passadas: linha.passadas })
          .eq("id", linha.id);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any).from("maquinas_modos_impressao").insert({
        maquina_id: maquinaId,
        nome: linha.nome,
        velocidade_m2_h: linha.velocidade_m2_h,
        passadas: linha.passadas,
        ordem: modos.length + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      setNome("");
      setVel("");
      setPassadas("");
      toast.success("Modo salvo");
    },
    onError: (e: any) => toast.error(e.message ?? "Não deu para salvar o modo"),
  });

  // O padrão é único por máquina (índice parcial no banco). Limpar antes de
  // marcar evita a colisão que o banco recusaria — e recusa de índice parcial
  // sai como erro de chave duplicada, que não explica nada a quem está na tela.
  const marcarPadrao = useMutation({
    mutationFn: async (id: string) => {
      const { error: erroLimpa } = await (supabase as any)
        .from("maquinas_modos_impressao")
        .update({ padrao: false })
        .eq("maquina_id", maquinaId)
        .eq("padrao", true);
      if (erroLimpa) throw erroLimpa;
      const { error } = await (supabase as any)
        .from("maquinas_modos_impressao")
        .update({ padrao: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      toast.success("Modo padrão trocado");
    },
    onError: (e: any) => toast.error(e.message ?? "Não deu para trocar o padrão"),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("maquinas_modos_impressao").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      toast.success("Modo removido");
    },
    onError: (e: any) => toast.error(e.message ?? "Não deu para remover"),
  });

  return (
    <Painel
      titulo={`Modos de qualidade (${modos.length})`}
      ajuda="Mais passadas, menos m²/h e mais tempo de máquina. Os valores vieram da proporção de passadas sobre a velocidade medida da casa — meça um trabalho em cada modo e corrija aqui."
    >
      {modos.map((mo) => (
        <div key={mo.id} className="grid grid-cols-12 gap-1.5 items-center text-xs">
          <div className="col-span-4 truncate" title={mo.nome}>
            {mo.nome}
          </div>
          <Input
            className="col-span-3 h-8 font-mono text-xs"
            type="number"
            step="0.1"
            defaultValue={String(mo.velocidade_m2_h ?? "")}
            aria-label={`m²/h de ${mo.nome}`}
            onBlur={(e) => {
              const v = n(e.target.value);
              if (v > 0 && v !== Number(mo.velocidade_m2_h)) {
                salvar.mutate({ id: mo.id, nome: mo.nome, velocidade_m2_h: v, passadas: mo.passadas });
              }
            }}
          />
          <span className="col-span-2 text-[10px] text-muted-foreground">
            {mo.passadas ? `${mo.passadas} pass.` : "—"}
          </span>
          <div className="col-span-3 flex items-center justify-end gap-1">
            {mo.padrao ? (
              <span className="text-[10px] font-medium text-primary">padrão</span>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-1.5 text-[10px]"
                disabled={marcarPadrao.isPending}
                onClick={() => marcarPadrao.mutate(mo.id)}
              >
                usar
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Remover modo ${mo.nome}`}
              onClick={() => remover.mutate(mo.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <div className="grid grid-cols-12 gap-1.5 items-center border-t pt-1.5">
        <Input className="col-span-4 h-8 text-xs" placeholder="Nome do modo" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Input className="col-span-3 h-8 font-mono text-xs" type="number" step="0.1" placeholder="m²/h" value={vel} onChange={(e) => setVel(e.target.value)} />
        <Input className="col-span-2 h-8 font-mono text-xs" type="number" step="1" placeholder="pass." value={passadas} onChange={(e) => setPassadas(e.target.value)} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="col-span-3 h-8 text-xs"
          disabled={!nome.trim() || n(vel) <= 0 || salvar.isPending}
          onClick={() => salvar.mutate({ nome: nome.trim(), velocidade_m2_h: n(vel), passadas: n(passadas) || null })}
        >
          <Plus className="h-3 w-3 mr-1" /> Modo
        </Button>
      </div>
    </Painel>
  );
}

/* -------------------------------------------------------------------------- */
/* Velocidade por material e espessura                                         */
/* -------------------------------------------------------------------------- */

function Velocidades({ maquinaId }: { maquinaId: string }) {
  const qc = useQueryClient();
  const [material, setMaterial] = useState("");
  const [espessura, setEspessura] = useState("");
  const [vel, setVel] = useState("");

  const { data: linhas = [] } = useQuery({
    queryKey: ["maquina-velocidades", maquinaId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("maquinas_velocidades")
        .select("id, operacao, material, espessura_mm, velocidade_mm_s, vetado, motivo, fonte")
        .eq("maquina_id", maquinaId)
        .order("vetado", { ascending: false })
        .order("material")
        .order("espessura_mm");
      return (data ?? []) as any[];
    },
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["maquina-velocidades", maquinaId] });
    qc.invalidateQueries({ queryKey: ["calc-velocidades"] });
  };

  const salvar = useMutation({
    mutationFn: async (linha: { id?: string; material: string; espessura_mm: number; velocidade_mm_s: number }) => {
      if (linha.id) {
        const { error } = await (supabase as any)
          .from("maquinas_velocidades")
          // Corrigir a velocidade apaga a fonte antiga: a linha deixa de ser
          // "estimativa por analogia" e passa a ser o que a oficina mediu.
          .update({ velocidade_mm_s: linha.velocidade_mm_s, fonte: "medido na oficina" })
          .eq("id", linha.id);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any).from("maquinas_velocidades").insert({
        maquina_id: maquinaId,
        operacao: "corte",
        material: linha.material.toLowerCase(),
        espessura_mm: linha.espessura_mm,
        velocidade_mm_s: linha.velocidade_mm_s,
        fonte: "medido na oficina",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      setMaterial("");
      setEspessura("");
      setVel("");
      toast.success("Velocidade salva");
    },
    onError: (e: any) => toast.error(e.message ?? "Não deu para salvar"),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("maquinas_velocidades").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidar();
      toast.success("Linha removida");
    },
    onError: (e: any) => toast.error(e.message ?? "Não deu para remover"),
  });

  const vetadas = linhas.filter((l) => l.vetado);
  const medidas = linhas.filter((l) => !l.vetado);
  const estimadas = medidas.filter((l) => String(l.fonte ?? "").toLowerCase().includes("estimativa")).length;

  return (
    <Painel
      titulo={`Velocidade por material (${medidas.length})`}
      ajuda="A velocidade depende da chapa: acrílico de 3 mm corta a 25 mm/s e o de 10 mm a 3 mm/s. Espessura sem linha usa a de cima — a de baixo não atravessa."
    >
      {estimadas > 0 && (
        <p className="text-[11px] text-amber-600">
          {estimadas === 1 ? "1 linha é estimativa" : `${estimadas} linhas são estimativa`} por analogia, não
          medição. Corte uma peça de teste e corrija o número aqui.
        </p>
      )}

      {medidas.map((l) => (
        <div key={l.id} className="grid grid-cols-12 gap-1.5 items-center text-xs">
          <div className="col-span-4 truncate" title={`${l.material} — ${l.fonte ?? ""}`}>
            {l.material}
            {l.operacao !== "corte" && <span className="text-muted-foreground"> ({l.operacao})</span>}
          </div>
          <div className="col-span-2 font-mono text-[11px] text-muted-foreground">
            {Number(l.espessura_mm) > 0 ? `${Number(l.espessura_mm)} mm` : "—"}
          </div>
          <Input
            className="col-span-4 h-8 font-mono text-xs"
            type="number"
            step="1"
            defaultValue={String(l.velocidade_mm_s ?? "")}
            aria-label={`mm/s de ${l.material} ${l.espessura_mm} mm`}
            onBlur={(e) => {
              const v = n(e.target.value);
              if (v > 0 && v !== Number(l.velocidade_mm_s)) {
                salvar.mutate({ id: l.id, material: l.material, espessura_mm: Number(l.espessura_mm), velocidade_mm_s: v });
              }
            }}
          />
          <div className="col-span-2 flex justify-end">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Remover ${l.material} ${l.espessura_mm} mm`}
              onClick={() => remover.mutate(l.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <div className="grid grid-cols-12 gap-1.5 items-center border-t pt-1.5">
        <Input className="col-span-4 h-8 text-xs" placeholder="Material" value={material} onChange={(e) => setMaterial(e.target.value)} />
        <Input className="col-span-2 h-8 font-mono text-xs" type="number" step="0.5" placeholder="mm" value={espessura} onChange={(e) => setEspessura(e.target.value)} />
        <Input className="col-span-4 h-8 font-mono text-xs" type="number" step="1" placeholder="mm/s" value={vel} onChange={(e) => setVel(e.target.value)} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="col-span-2 h-8 px-1"
          aria-label="Adicionar velocidade"
          disabled={!material.trim() || n(vel) <= 0 || salvar.isPending}
          onClick={() => salvar.mutate({ material: material.trim(), espessura_mm: n(espessura), velocidade_mm_s: n(vel) })}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {/* Os vetos ficam à vista e sem campo de edição: são regra de processo,
          não parâmetro de oficina. Quem quiser mudar, remove a linha de
          propósito — e aí é uma decisão, não um clique distraído. */}
      {vetadas.length > 0 && (
        <div className="mt-2 space-y-1 border-t pt-2">
          <div className="text-[11px] font-medium text-destructive">Esta máquina não processa</div>
          {vetadas.map((l) => (
            <div key={l.id} className="flex items-start gap-1.5 text-[11px]">
              <span className="font-medium">{l.material}</span>
              <span className="text-muted-foreground flex-1">{l.motivo}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 flex-shrink-0"
                aria-label={`Remover veto de ${l.material}`}
                onClick={() => remover.mutate(l.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Painel>
  );
}

export function ParametrosDeMaquina({ maquinaId, base }: { maquinaId: string; base: string | null }) {
  if (base === "area") return <Modos maquinaId={maquinaId} />;
  if (base === "tempo") return <Velocidades maquinaId={maquinaId} />;
  return null;
}
