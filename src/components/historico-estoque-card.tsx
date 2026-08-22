import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, Receipt } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { gerarESalvarPDF } from "@/lib/pdf/generate";

type Movimento = {
  id: string;
  created_at: string;
  tipo: string;
  quantidade: number;
  observacao: string | null;
  material_id: string;
  usuario_id: string | null;
};

export function HistoricoEstoqueCard({ osId }: { osId: string }) {
  const [gerando, setGerando] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["historico-estoque", osId],
    queryFn: async () => {
      const { data: movs } = await supabase
        .from("movimentacoes_estoque")
        .select("id, created_at, tipo, quantidade, observacao, material_id, usuario_id")
        .eq("os_id", osId)
        .order("created_at", { ascending: false });
      const movimentos = (movs ?? []) as Movimento[];
      if (movimentos.length === 0)
        return { movimentos, materiais: {} as Record<string, any>, usuarios: {} as Record<string, any> };

      const matIds = [...new Set(movimentos.map((m) => m.material_id))];
      const usrIds = [...new Set(movimentos.map((m) => m.usuario_id).filter(Boolean))] as string[];

      const [{ data: materiais }, { data: usuarios }] = await Promise.all([
        supabase.from("materiais").select("id, nome, unidade").in("id", matIds),
        usrIds.length
          ? supabase.from("usuarios").select("id, nome").in("id", usrIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const matMap: Record<string, any> = {};
      for (const m of materiais ?? []) matMap[(m as any).id] = m;
      const usrMap: Record<string, any> = {};
      for (const u of usuarios ?? []) usrMap[(u as any).id] = u;

      return { movimentos, materiais: matMap, usuarios: usrMap };
    },
  });

  const movimentos = data?.movimentos ?? [];
  const temSaida = movimentos.some((m) => m.tipo === "saida");

  async function emitirRecibo() {
    setGerando(true);
    try {
      await gerarESalvarPDF({ tipo: "recibo_material", referencia_id: osId });
      toast.success("Recibo gerado");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar o recibo");
    } finally {
      setGerando(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            Histórico de baixa de estoque
          </CardTitle>
          {/* Só há recibo a emitir quando material de fato saiu: entrada e
              inventário não geram retirada para alguém assinar. */}
          {temSaida && (
            <Button variant="outline" size="sm" disabled={gerando} onClick={emitirRecibo}>
              <Receipt className="h-4 w-4 mr-1" />
              {gerando ? "Gerando…" : "Recibo de retirada"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">Carregando…</div>
        ) : movimentos.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            Nenhuma movimentação de estoque registrada para esta OS.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Quantidade</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Observação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movimentos.map((m) => {
                const mat = data!.materiais[m.material_id];
                const usr = m.usuario_id ? data!.usuarios[m.usuario_id] : null;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {mat?.nome ?? "(removido)"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {Number(m.quantidade)} {mat?.unidade ?? ""}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={m.tipo === "saida" ? "destructive" : "secondary"}
                        className="capitalize"
                      >
                        {m.tipo}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {usr?.nome ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.observacao ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
