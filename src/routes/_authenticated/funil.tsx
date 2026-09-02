import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/funil")({
  head: () => ({ meta: [{ title: "Funil comercial — BEX PRINT OS" }] }),
  component: FunilPage,
});

type Linha = {
  lead_id: string;
  nome: string;
  origem: string;
  campanha: string | null;
  status: string;
  valor_potencial: number;
  criado_em: string;
  cliente_id: string | null;
  cliente: string | null;
  orcamentos: number;
  valor_orcado: number;
  orcamentos_aprovados: number;
  ordens: number;
  valor_fechado: number;
  ordens_concluidas: number;
  estagio: string;
  dias_parado: number;
};

const brl = (n: number) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Ordem do funil, do primeiro contato à peça entregue. */
const ESTAGIOS = [
  { chave: "lead", rotulo: "Lead" },
  { chave: "cliente", rotulo: "Virou cliente" },
  { chave: "orcado", rotulo: "Orçado" },
  { chave: "fechado", rotulo: "Fechado" },
  { chave: "em producao", rotulo: "Em produção" },
  { chave: "entregue", rotulo: "Entregue" },
  { chave: "perdido", rotulo: "Perdido" },
];

const tomDoEstagio: Record<string, "secondary" | "outline" | "destructive"> = {
  entregue: "secondary",
  "em producao": "secondary",
  fechado: "secondary",
  perdido: "destructive",
};

const hoje = new Date().toISOString().slice(0, 10);
const noventa = new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10);

/**
 * Funil comercial: o que entra, o que vira venda e o que parou no caminho.
 *
 * Os elos existiam — o orçamento guarda o lead, a OS guarda o orçamento — e a
 * tela de Leads nunca os ligava. Sem isso a origem comercial se perdia: não dava
 * para dizer quanto o Instagram trouxe nem quantos orçamentos morreram sem
 * resposta, que é a pergunta que decide onde gastar em divulgação.
 */
function FunilPage() {
  const { canSeeFinancials } = useAuth();
  const [inicio, setInicio] = useState(noventa);
  const [fim, setFim] = useState(hoje);

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["funil", inicio, fim],
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await (supabase.rpc as any)("funil_comercial", {
        p_inicio: inicio,
        p_fim: fim,
      });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  const resumo = useMemo(() => {
    const porEstagio = new Map<string, number>();
    for (const l of linhas) porEstagio.set(l.estagio, (porEstagio.get(l.estagio) ?? 0) + 1);

    const entregue = linhas.filter((l) => l.estagio === "entregue");
    const perdido = linhas.filter((l) => l.estagio === "perdido");
    // "Falta fechar" é tudo que não virou venda nem morreu — o que ainda dá
    // para trabalhar.
    const emAberto = linhas.filter(
      (l) => !["entregue", "perdido"].includes(l.estagio),
    );

    // Por origem: qual canal traz dinheiro, não só volume.
    const porOrigem = new Map<string, { leads: number; fechado: number; entregues: number }>();
    for (const l of linhas) {
      const atual = porOrigem.get(l.origem) ?? { leads: 0, fechado: 0, entregues: 0 };
      atual.leads += 1;
      atual.fechado += Number(l.valor_fechado);
      if (l.estagio === "entregue") atual.entregues += 1;
      porOrigem.set(l.origem, atual);
    }

    return {
      porEstagio,
      total: linhas.length,
      entregues: entregue.length,
      perdidos: perdido.length,
      emAberto: emAberto.length,
      valorEmAberto: emAberto.reduce((s, l) => s + Number(l.valor_orcado || l.valor_potencial), 0),
      valorFechado: linhas.reduce((s, l) => s + Number(l.valor_fechado), 0),
      parados: emAberto.filter((l) => l.dias_parado > 15),
      origens: [...porOrigem.entries()].sort((a, b) => b[1].fechado - a[1].fechado),
    };
  }, [linhas]);

  return (
    <div>
      <SectionHeader
        breadcrumb="Comercial"
        title="Funil"
        description="Do primeiro contato à peça entregue: o que entrou, o que virou venda e o que parou no caminho."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="de" className="text-xs">De</Label>
          <Input id="de" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label htmlFor="ate" className="text-xs">Até</Label>
          <Input id="ate" type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" />
        </div>
      </div>

      {linhas.length > 0 && (
        <>
          <div className="mb-4 grid overflow-hidden rounded-md border sm:grid-cols-4">
            <Metrica rotulo="Entraram" valor={String(resumo.total)} nota="leads no período" />
            <Metrica rotulo="Entregues" valor={String(resumo.entregues)} nota="chegaram ao fim" />
            <Metrica
              rotulo="Falta fechar"
              valor={String(resumo.emAberto)}
              nota={canSeeFinancials ? `${brl(resumo.valorEmAberto)} em jogo` : "ainda dá para trabalhar"}
            />
            <Metrica rotulo="Perdidos" valor={String(resumo.perdidos)} nota="sem retorno" />
          </div>

          {/* Etapas em ordem: mostra onde o funil estrangula. */}
          <Card className="mb-4">
            <CardContent className="flex flex-wrap gap-2 p-4">
              {ESTAGIOS.map((e) => {
                const n = resumo.porEstagio.get(e.chave) ?? 0;
                if (n === 0) return null;
                return (
                  <Badge key={e.chave} variant={tomDoEstagio[e.chave] ?? "outline"} className="font-normal">
                    {e.rotulo}: {n}
                  </Badge>
                );
              })}
            </CardContent>
          </Card>

          {resumo.parados.length > 0 && (
            <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong>{resumo.parados.length}</strong>{" "}
                {resumo.parados.length === 1 ? "oportunidade parada" : "oportunidades paradas"} há
                mais de 15 dias sem movimento
                {canSeeFinancials && (
                  <>
                    , somando{" "}
                    {brl(
                      resumo.parados.reduce(
                        (s, l) => s + Number(l.valor_orcado || l.valor_potencial),
                        0,
                      ),
                    )}
                  </>
                )}
                . Orçamento sem resposta não morre sozinho — alguém precisa ligar.
              </div>
            </div>
          )}
        </>
      )}

      {resumo.origens.length > 1 && canSeeFinancials && (
        <Card className="mb-4">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Entregues</TableHead>
                  <TableHead className="text-right">Fechado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumo.origens.map(([origem, d]) => (
                  <TableRow key={origem}>
                    <TableCell className="font-medium">{origem}</TableCell>
                    <TableCell className="text-right font-mono">{d.leads}</TableCell>
                    <TableCell className="text-right font-mono">{d.entregues}</TableCell>
                    <TableCell className="text-right font-mono">{brl(d.fechado)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
          ) : linhas.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              Nenhum lead no período. O funil se enche quando os leads forem cadastrados em
              Leads e o orçamento nascer a partir deles.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Estágio</TableHead>
                    <TableHead className="text-right">Orçado</TableHead>
                    <TableHead className="text-right">Fechado</TableHead>
                    <TableHead className="text-right">Parado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l) => (
                    <TableRow key={l.lead_id}>
                      <TableCell>
                        <div className="font-medium">{l.nome}</div>
                        {l.cliente && (
                          <div className="text-xs text-muted-foreground">
                            cliente: {l.cliente}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {l.origem}
                        {l.campanha && (
                          <div className="text-xs text-muted-foreground">{l.campanha}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tomDoEstagio[l.estagio] ?? "outline"} className="font-normal">
                          {ESTAGIOS.find((e) => e.chave === l.estagio)?.rotulo ?? l.estagio}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {l.orcamentos > 0 ? brl(l.valor_orcado) : "—"}
                        {l.orcamentos > 1 && (
                          <div className="text-xs text-muted-foreground">
                            {l.orcamentos} orçamentos
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {l.ordens > 0 ? brl(l.valor_fechado) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {["entregue", "perdido"].includes(l.estagio) ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={`font-mono text-sm ${l.dias_parado > 15 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}
                          >
                            {l.dias_parado}d
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        O estágio vem da cadeia real — orçamento gerado, OS aberta, produção concluída — e não do
        status digitado no lead. Ninguém volta na tela de Leads para marcar “virou cliente”
        depois que a peça já saiu.{" "}
        <Link to="/leads" className="underline">Ir para Leads</Link>
      </p>
    </div>
  );
}

function Metrica({ rotulo, valor, nota }: { rotulo: string; valor: string; nota: string }) {
  return (
    <div className="border-r bg-card p-4 last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </div>
      <div className="mt-1 text-2xl font-semibold">{valor}</div>
      <div className="text-xs text-muted-foreground">{nota}</div>
    </div>
  );
}
