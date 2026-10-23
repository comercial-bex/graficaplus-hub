import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusChip } from "@/components/bex/StatusChip";
import { supabase } from "@/integrations/supabase/client";
import { resumoDosParceiros, type ResumoDoParceiro } from "@/lib/parceiro-api";
import { mensagemErro } from "@/lib/erros";

/**
 * Acesso dos parceiros e terceirizados — só cadastro, sem equipe.
 *
 * Quem se inscreve entra na hora (o cadastro cria o parceiro `ativo` com o
 * papel que abre /parceiro). Aqui a equipe CONTROLA: suspender bloqueia o
 * painel dele (`parceiro_painel` responde 42501) e liberar de novo reabre.
 * O que o parceiro faz no dia a dia (nível, crédito, atendente) fica em
 * Parceiros; esta aba é só a porta.
 */

const ROTULO: Record<string, { texto: string; tom: "lime" | "amber" | "muted" }> = {
  ativo: { texto: "Liberado", tom: "lime" },
  pendente: { texto: "Aguardando", tom: "amber" },
  suspenso: { texto: "Suspenso", tom: "muted" },
  encerrado: { texto: "Encerrado", tom: "muted" },
};

export function ParceirosAcesso({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const { data: parceiros = [], isLoading, error } = useQuery({
    queryKey: ["parceiros-resumo"],
    queryFn: resumoDosParceiros,
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return parceiros.filter((p) => !termo || `${p.nome} ${p.usuario_email ?? ""}`.toLowerCase().includes(termo));
  }, [parceiros, busca]);

  async function mudar(p: ResumoDoParceiro, liberar: boolean) {
    try {
      const { data, error: erro } = await (supabase as any)
        .from("parceiros")
        .update({ status: liberar ? "ativo" : "suspenso" })
        .eq("id", p.id)
        .select("id");
      if (erro) throw erro;
      if (!data?.length) throw new Error("Seu perfil não tem permissão para alterar parceiros.");
      toast.success(liberar ? "Acesso liberado" : "Acesso suspenso");
      qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível alterar o acesso."));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Quem se cadastra como parceiro ou terceirizado entra na hora, sem pedir permissão. Aqui você vê quem tem acesso
          e pode suspender (ou liberar de novo). Nível, crédito e atendente ficam em{" "}
          <Link to="/parceiros" className="underline underline-offset-4">Parceiros</Link>.
        </p>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou e-mail" className="pl-9" />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parceiro</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead>Último acesso</TableHead>
                <TableHead>Acesso ao painel</TableHead>
                <TableHead className="text-right">Cadastro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Carregando parceiros...</TableCell></TableRow>
              )}
              {!isLoading && error && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-destructive">{mensagemErro(error, "Falha ao carregar parceiros")}</TableCell></TableRow>
              )}
              {!isLoading && !error && lista.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Nenhum parceiro cadastrado.</TableCell></TableRow>
              )}
              {lista.map((p) => {
                const rotulo = ROTULO[p.status] ?? ROTULO.encerrado;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-sm">
                      {p.usuario_email ?? <span className="text-muted-foreground">sem login</span>}
                    </TableCell>
                    <TableCell className="text-sm">{p.nivel?.nome ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {p.ultimo_acesso_em ? new Date(p.ultimo_acesso_em).toLocaleDateString("pt-BR") : "nunca"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={p.status === "ativo"}
                          disabled={!podeEditar || p.status === "encerrado"}
                          aria-label={`Acesso de ${p.nome}`}
                          onCheckedChange={(v) => mudar(p, v)}
                        />
                        <StatusChip label={rotulo.texto} tone={rotulo.tom} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link to="/clientes/$id" params={{ id: p.cliente_id }} className="inline-flex items-center gap-1 text-sm underline underline-offset-4">
                        Abrir <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
