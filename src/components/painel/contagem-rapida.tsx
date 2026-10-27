/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FolhaDeContagem, type MaterialParaContar } from "@/components/estoque/folha-de-contagem";

/**
 * A folha de contagem aberta DENTRO do painel, só com os materiais que nunca receberam entrada.
 *
 * O cartão "Materiais que nunca receberam entrada" levava para Materiais, que não tem onde dar
 * entrada em lote: a folha de contagem mora em Movimentações. Quem clicava chegava numa lista e
 * tinha de adivinhar o caminho — com 18 materiais, 18 idas e vindas. Aqui a folha abre por cima do
 * painel com a mesma lista que o cartão contou (saldo zero e nenhuma movimentação), e ao aplicar o
 * cartão se relê sozinho.
 *
 * A regra da lista é a MESMA de `pendencias_do_sistema` (`estoque_nunca_carregado`): saldo <= 0 e
 * nenhuma linha em movimentacoes_estoque. Material com saldo mas sem movimentação (cadastrado com
 * "saldo informado") fica de fora, como no cartão.
 */
export function ContagemRapidaDoPainel({
  aberta,
  onAbertaChange,
}: {
  aberta: boolean;
  onAbertaChange: (v: boolean) => void;
}) {
  const { data: materiais = [] } = useQuery({
    queryKey: ["materiais-sem-entrada"],
    enabled: aberta,
    queryFn: async (): Promise<MaterialParaContar[]> => {
      const { data: zerados, error } = await (supabase as any)
        .from("materiais")
        .select("id, nome, unidade, estoque")
        .lte("estoque", 0)
        .order("nome");
      if (error) throw error;
      const lista = (zerados ?? []) as MaterialParaContar[];
      if (lista.length === 0) return [];
      const { data: movs, error: erroMovs } = await (supabase as any)
        .from("movimentacoes_estoque")
        .select("material_id")
        .in(
          "material_id",
          lista.map((m) => m.id),
        );
      // Sem poder ler as movimentações não dá para saber quem "nunca recebeu": melhor falhar do que
      // mostrar uma lista que inclui material que já teve entrada.
      if (erroMovs) throw erroMovs;
      const comMovimento = new Set(((movs ?? []) as { material_id: string }[]).map((m) => m.material_id));
      return lista.filter((m) => !comMovimento.has(m.id));
    },
  });

  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Belem" });

  return (
    <FolhaDeContagem
      materiais={materiais}
      aberta={aberta}
      onAbertaChange={onAbertaChange}
      motivoInicial={`Entrada inicial do estoque, ${hoje}`}
    />
  );
}
