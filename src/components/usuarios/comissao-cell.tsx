import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dica } from "@/components/bex/Dica";

/**
 * A comissão de uma pessoa da equipe, editável na lista de usuários.
 *
 * Vive em `comissao_regras`, não em `usuarios`: a policy de `usuarios` deixa
 * cada um editar a própria linha, e um percentual ali seria auto-aumento de
 * salário. A tabela própria só aceita escrita de admin e gestor — a tela
 * espelha isso, mas a trava está no banco.
 *
 * Cada 1 ponto de comissão sobre o bruto tira exatamente 1 ponto da margem
 * daquela OS. A dica ao lado do campo diz isso, porque é a conta que a
 * gestão precisa fazer antes de digitar o número.
 */

type Regra = { pct: number; ativa: boolean } | null;

export function ComissaoCell({ usuarioId }: { usuarioId: string }) {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const podeEditar = hasRole("admin") || hasRole("gestor");
  const [aberto, setAberto] = useState(false);
  const [pct, setPct] = useState("");
  const [ativa, setAtiva] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const { data: regra } = useQuery({
    queryKey: ["comissao-regra", usuarioId],
    queryFn: async (): Promise<Regra> => {
      const { data, error } = await (supabase as any)
        .from("comissao_regras")
        .select("pct, ativa")
        .eq("usuario_id", usuarioId)
        .maybeSingle();
      if (error) throw error;
      return (data as Regra) ?? null;
    },
  });

  useEffect(() => {
    if (aberto) {
      setPct(regra ? String(Number(regra.pct)) : "");
      setAtiva(regra ? regra.ativa : true);
    }
  }, [aberto, regra]);

  async function salvar() {
    const n = Number(String(pct).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100) return toast.error("Informe um percentual entre 0 e 100.");
    setSalvando(true);
    try {
      const { error } = await (supabase as any)
        .from("comissao_regras")
        .upsert({ usuario_id: usuarioId, pct: n, ativa, updated_at: new Date().toISOString() }, { onConflict: "usuario_id" });
      if (error) throw error;
      toast.success(n > 0 && ativa ? `Comissão de ${n}% salva.` : "Comissão desligada.");
      qc.invalidateQueries({ queryKey: ["comissao-regra", usuarioId] });
      qc.invalidateQueries({ queryKey: ["equipe-para-venda"] });
      setAberto(false);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const rotulo = regra && regra.ativa && Number(regra.pct) > 0
    ? `${Number(regra.pct)}%`
    : "—";

  if (!podeEditar) {
    return <span className="font-mono text-sm tabular-nums text-muted-foreground">{rotulo}</span>;
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 font-mono tabular-nums">
          <BadgePercent className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
          {rotulo}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div>
          <p className="text-sm font-medium">Comissão sobre o bruto da OS</p>
          <p className="text-xs text-muted-foreground">
            Paga quando a OS que essa pessoa trouxe é paga. Cada 1 ponto aqui tira 1 ponto da margem daquela OS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number" step="0.5" min="0" max="100"
            className="h-9 w-24 font-mono"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            placeholder="0"
          />
          <span className="text-sm text-muted-foreground">%</span>
          <Dica texto="Desligada, a regra fica guardada mas não gera comissão nova. Comissões já lançadas não mudam.">
            <label className="ml-auto flex items-center gap-2 text-xs">
              <Switch checked={ativa} onCheckedChange={setAtiva} /> ativa
            </label>
          </Dica>
        </div>
        <Button size="sm" className="w-full" disabled={salvando} onClick={salvar}>
          <Check className="mr-1 h-4 w-4" /> {salvando ? "Salvando..." : "Salvar"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
