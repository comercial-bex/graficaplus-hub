import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Carregando } from "@/components/bex/Carregando";
import { supabase } from "@/integrations/supabase/client";
import {
  linhaDoTempoDoCliente,
  mensagemDaNota,
  quandoPorExtenso,
  type NotaDoCliente,
} from "@/domain/clientes/historico";

const LIMITE = 2000;

/**
 * A aba Histórico do cliente, como a do Holdprint: "Registrar nota" em cima e a linha do tempo embaixo,
 * da nota mais nova até o cadastro. Falha na consulta aparece como falha, nunca como "sem notas".
 */
export function HistoricoDoCliente({
  clienteId,
  cadastradoEm,
}: {
  clienteId: string;
  cadastradoEm: string | null | undefined;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  // A tabela é nova e o types.ts é gerado pelo Lovable: ainda não a conhece.
  const db = supabase as any;

  const notas = useQuery({
    queryKey: ["cliente-notas", clienteId],
    queryFn: async (): Promise<NotaDoCliente[]> => {
      const { data, error } = await db
        .from("cliente_notas")
        .select("id, texto, autor_id, created_at")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as NotaDoCliente[];
    },
  });

  const idsDosAutores = [...new Set((notas.data ?? []).map((n) => n.autor_id).filter((x): x is string => !!x))];
  const autores = useQuery({
    queryKey: ["cliente-notas-autores", idsDosAutores.join(",")],
    enabled: idsDosAutores.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("usuarios").select("id, nome").in("id", idsDosAutores);
      return Object.fromEntries((data ?? []).map((u: { id: string; nome: string | null }) => [u.id, u.nome ?? ""]));
    },
  });

  const registrar = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("cliente_notas").insert({ cliente_id: clienteId, texto: texto.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setTexto("");
      toast.success("Nota registrada");
      qc.invalidateQueries({ queryKey: ["cliente-notas", clienteId] });
    },
    onError: (e) => toast.error(mensagemDaNota(e)),
  });

  const linhas = linhaDoTempoDoCliente(notas.data ?? [], cadastradoEm);
  const vazia = texto.trim().length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <Label htmlFor="nota-do-cliente" className="text-base font-semibold">
            Registrar nota
          </Label>
          <Textarea
            id="nota-do-cliente"
            rows={3}
            maxLength={LIMITE}
            placeholder="O que a equipe precisa saber sobre este cliente: combinado de entrega, forma de pagar, quem decide..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="text-base"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground tabular-nums">
              {texto.length} de {LIMITE}
            </span>
            <Button type="button" disabled={vazia || registrar.isPending} onClick={() => registrar.mutate()}>
              {registrar.isPending ? "Registrando…" : "Registrar nota"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {notas.isLoading ? (
            <div className="p-4">
              <Carregando />
            </div>
          ) : notas.error ? (
            <p role="alert" className="p-4 text-base text-destructive">
              Não consegui carregar o histórico. Recarregue a página; se continuar, avise o suporte.
            </p>
          ) : (
            <ol className="divide-y divide-border" aria-label="Histórico do cliente">
              {linhas.map((l) => (
                <li key={l.id} data-tipo={l.tipo} className="space-y-1 p-4">
                  <p className="whitespace-pre-wrap text-base text-foreground">{l.texto}</p>
                  <p className="text-sm text-muted-foreground">
                    {l.tipo === "nota" && autores.data?.[l.autorId ?? ""] ? `${autores.data[l.autorId ?? ""]} · ` : ""}
                    {quandoPorExtenso(l.quando)}
                  </p>
                </li>
              ))}
              {notas.data?.length === 0 && (
                <li className="p-4 text-base text-muted-foreground">
                  Nenhuma nota ainda. A primeira que a equipe registrar aparece aqui.
                </li>
              )}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
