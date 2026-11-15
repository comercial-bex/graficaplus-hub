import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeloDaMaquina } from "@/components/kanban/icone-da-maquina";
import { SeletorDeMaquina } from "@/components/painel/SeletorDeMaquina";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { etapaDe } from "@/domain/os/etapas";
import { ondeEstaRodando, type ApontamentoAberto } from "@/domain/os/comecar-na-maquina";
import { ehGestor, primeiroNome } from "@/domain/os/equipe-da-producao";

/**
 * A máquina, dentro da ficha do quadro (pedido do dono, 15/11/2026).
 *
 * "Eu seleciono o operador e o operador seleciona a máquina — dentro do modal da
 * tarefa do Kanban." Na fila e na produção, a ficha mostra a máquina e:
 *   - "Escolher a máquina e começar": os mesmos botões do painel do operador
 *     (`SeletorDeMaquina`): a sugerida pelo produto em destaque, a ocupada dizendo
 *     com o quê, e um toque começa a contar o tempo (`comecar_na_maquina`, que já
 *     leva a OS ao status da máquina pelas travas de sempre). Só quem aponta
 *     (producao.start).
 *   - Na fila, "Fila da máquina": deixa a OS esperando numa máquina sem começar
 *     (`definir_maquina_da_os`) — a TV da Oficina já mostra a OS na fila dessa
 *     máquina. O operador ou o gestor.
 */

type OsDaFicha = {
  id: string;
  numero?: number | null;
  titulo?: string | null;
  status: string;
  operador_id?: string | null;
  maquina_id?: string | null;
  maquinas?: { nome?: string | null; tipo?: string | null } | null;
  operador?: { nome?: string | null } | null;
};

export function MaquinaDaOs({ os }: { os: OsDaFicha }) {
  const qc = useQueryClient();
  const { user, roles, hasPermission } = useAuth();
  const podeComecar = hasPermission("producao.start");
  const podePorNaFila = podeComecar || ehGestor(roles);
  const etapa = etapaDe(os.status);
  const naFila = etapa === "fila_producao";
  const [escolhendo, setEscolhendo] = useState(false);

  const abertos = useQuery({
    // Dentro do prefixo do painel: o seletor invalida ["painel-producao"] ao começar e ao terminar.
    queryKey: ["painel-producao", "apontamentos-da-os", os.id],
    enabled: etapa === "fila_producao" || etapa === "producao",
    queryFn: async (): Promise<ApontamentoAberto[]> => {
      const { data, error } = await (supabase as any)
        .from("apontamentos_producao")
        .select("id, os_id, maquina_id, iniciado_em, maquinas(nome, tipo)")
        .eq("os_id", os.id)
        .is("finalizado_em", null)
        .order("iniciado_em", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApontamentoAberto[];
    },
  });

  const maquinas = useQuery({
    queryKey: ["maquinas-ativas"],
    enabled: naFila && podePorNaFila,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ id: string; nome: string; tipo: string | null }[]> => {
      const { data, error } = await supabase.from("maquinas").select("id, nome, tipo").eq("ativa", true).order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; tipo: string | null }[];
    },
  });

  const atualizar = () => {
    for (const chave of [["kanban-os"], ["kanban-bloqueios"], ["painel-producao"]]) {
      void qc.invalidateQueries({ queryKey: chave });
    }
  };

  const porNaFila = useMutation({
    mutationFn: async (maquinaId: string | null) => {
      const { data, error } = await (supabase.rpc as any)("definir_maquina_da_os", {
        p_os_id: os.id,
        p_maquina_id: maquinaId,
      });
      if (error) throw error;
      return data as { maquina_nome?: string | null } | null;
    },
    onSuccess: (r, maquinaId) => {
      toast.success(maquinaId ? `OS #${os.numero ?? ""} na fila da ${r?.maquina_nome ?? "máquina"}.` : "A OS saiu da fila da máquina.", {
        description: maquinaId ? "Para começar a contar o tempo, use “Escolher a máquina e começar”." : undefined,
      });
      atualizar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (etapa !== "fila_producao" && etapa !== "producao") return null;

  const rodando = ondeEstaRodando(abertos.data ?? []);
  const ehMeu = !!user?.id && os.operador_id === user.id;
  const operador = os.operador?.nome ? primeiroNome(os.operador.nome) : null;

  return (
    <div className="space-y-2 text-xs">
      {rodando.length > 0 ? (
        <ul className="space-y-1" aria-label="Rodando agora">
          {rodando.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <SeloDaMaquina identidade={r.maquina} />
              {r.desde && <span className="text-muted-foreground">rodando desde {r.desde}</span>}
            </li>
          ))}
        </ul>
      ) : os.maquinas?.nome ? (
        <p>
          <span className="text-muted-foreground">{naFila ? "Na fila da " : "Máquina: "}</span>
          <span className="font-medium text-foreground/85">{os.maquinas.nome}</span>
          {naFila && <span className="text-muted-foreground"> · ainda não começou</span>}
        </p>
      ) : (
        <p className="text-muted-foreground">Ainda sem máquina.</p>
      )}

      <p className="text-muted-foreground">
        {operador ? (
          <>
            Operador: <span className="font-medium text-foreground/85">{ehMeu ? "você" : operador}</span>
            {naFila && " — o operador escolhe a máquina."}
          </>
        ) : (
          "Ainda sem operador: escolha quem vai produzir em “Combinado e equipe”."
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {podeComecar && (
          <Button type="button" size="sm" variant={ehMeu ? "default" : "outline"} onClick={() => setEscolhendo(true)}>
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {rodando.length > 0 ? "Outra máquina ou terminar" : "Escolher a máquina e começar"}
          </Button>
        )}
        {naFila && podePorNaFila && (
          <Select
            value={os.maquina_id ?? "nenhuma"}
            disabled={porNaFila.isPending || maquinas.isPending}
            onValueChange={(v) => porNaFila.mutate(v === "nenhuma" ? null : v)}
          >
            <SelectTrigger className="h-9 w-full sm:w-64" aria-label="Pôr na fila de uma máquina, sem começar">
              <SelectValue placeholder="Fila da máquina…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nenhuma">Sem máquina (fila geral)</SelectItem>
              {(maquinas.data ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  Fila da {m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {!podeComecar && !podePorNaFila && (
        <p className="italic text-muted-foreground">Quem escolhe a máquina é o operador.</p>
      )}

      <SeletorDeMaquina
        os={escolhendo ? { id: os.id, numero: os.numero ?? null, titulo: os.titulo ?? null } : null}
        abertos={abertos.data ?? []}
        onFechar={() => {
          setEscolhendo(false);
          atualizar();
        }}
      />
    </div>
  );
}
