import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Dica } from "@/components/bex/Dica";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * "Quem trouxe a venda" — a pessoa da equipe que ganha comissão por esta OS.
 *
 * É a coluna `vendedor_id`, que já existia e era herdada em silêncio: do
 * cliente para o orçamento, do orçamento para a OS. Quem trazia a venda não
 * aparecia em lugar nenhum, e não havia onde corrigir. A comissão (% do bruto
 * da OS, paga quando a OS é paga) segue exatamente esta escolha.
 *
 * Pode ser qualquer pessoa da equipe ativa — quem traz venda nem sempre é
 * vendedor; o impressor traz cliente também. Quem pode MUDAR é só gestão e
 * atendimento: operador tem `os.update` para a produção, não para se apontar
 * numa OS alheia e ganhar comissão. A trava está no banco (gatilho e RPC),
 * a tela só a espelha.
 */

type Pessoa = { id: string; nome: string; tem_comissao: boolean };

export function useEquipeParaVenda() {
  return useQuery({
    queryKey: ["equipe-para-venda"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Pessoa[]> => {
      const { data, error } = await (supabase.rpc as any)("equipe_para_venda");
      if (error) throw error;
      return (data ?? []) as Pessoa[];
    },
  });
}

export function QuemTrouxeAVenda({
  alvo,
  id,
  vendedorId,
  invalidar,
  compacto = false,
}: {
  alvo: "os" | "orcamento";
  id: string;
  vendedorId: string | null | undefined;
  /** chaves de query a invalidar depois de trocar */
  invalidar: unknown[][];
  compacto?: boolean;
}) {
  const { hasRole, hasPermission } = useAuth();
  const qc = useQueryClient();
  const { data: equipe = [] } = useEquipeParaVenda();

  const podeMudar = hasRole("admin") || hasRole("gestor") || hasPermission("orcamentos.update");
  const atual = equipe.find((p) => p.id === vendedorId);

  async function mudar(novo: string) {
    const fn = alvo === "os" ? "os_definir_quem_trouxe" : "orcamento_definir_quem_trouxe";
    const args = alvo === "os"
      ? { p_os_id: id, p_usuario_id: novo === "none" ? null : novo }
      : { p_orcamento_id: id, p_usuario_id: novo === "none" ? null : novo };
    const { error } = await (supabase.rpc as any)(fn, args);
    if (error) return toast.error(mensagemErro(error));
    toast.success("Registrado quem trouxe a venda.");
    for (const k of invalidar) qc.invalidateQueries({ queryKey: k });
  }

  const rotulo = (
    <span className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
      <UserRound className="h-3.5 w-3.5" /> Quem trouxe a venda
    </span>
  );

  if (!podeMudar) {
    return (
      <div className={compacto ? "flex items-center gap-2" : "space-y-1"}>
        {rotulo}
        <span className="text-sm font-medium">
          {atual?.nome ?? "—"}
          {atual?.tem_comissao && <BadgePercent className="ml-1 inline h-3.5 w-3.5 text-[color:var(--bex-lime)]" />}
        </span>
      </div>
    );
  }

  return (
    <div className={compacto ? "flex items-center gap-2" : "space-y-1"}>
      <Dica texto="A pessoa da equipe que trouxe este trabalho. Se ela tiver comissão configurada, ganha um % do bruto quando a OS for paga. Qualquer um da equipe pode ser escolhido; só gestão e atendimento podem mudar.">
        {rotulo}
      </Dica>
      <Select value={vendedorId ?? "none"} onValueChange={mudar}>
        <SelectTrigger className="h-8 w-56 text-sm">
          <SelectValue placeholder="Escolher" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— ninguém —</SelectItem>
          {equipe.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.nome}
              {p.tem_comissao ? " · comissão" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
