import { createFileRoute, Link } from "@tanstack/react-router";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { Card, CardContent } from "@/components/ui/card";
import { mapaNodes, mapaEdges, perfisAtividades, type MapaNode } from "@/lib/system-map";

export const Route = createFileRoute("/_authenticated/mapa-sistema")({
  head: () => ({
    meta: [
      { title: "Mapa do sistema — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Mapa visual do ERP Bex Print: entidades, relações, fluxos entre perfis, atividades e rotas.",
      },
      { property: "og:title", content: "Mapa do sistema — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Visão geral das camadas, integrações e responsabilidades por perfil.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MapaSistemaPage,
});

const camadas: { id: MapaNode["camada"]; label: string; tone: "cyan" | "magenta" | "lime" | "amber" | "muted" }[] = [
  { id: "entrada", label: "Entrada / Atendimento", tone: "cyan" },
  { id: "comercial", label: "Comercial", tone: "magenta" },
  { id: "operacao", label: "Operação", tone: "amber" },
  { id: "producao", label: "Produção", tone: "lime" },
  { id: "financeiro", label: "Financeiro", tone: "amber" },
  { id: "posvenda", label: "Entrega & Pós-venda", tone: "muted" },
];

const tipoStyle: Record<MapaNode["tipo"], string> = {
  modulo: "border-[color:var(--bex-cyan)]/40 bg-[color:var(--bex-cyan)]/5",
  entidade: "border-[color:var(--bex-magenta)]/40 bg-[color:var(--bex-magenta)]/5",
  integracao: "border-[color:var(--bex-lime)]/40 bg-[color:var(--bex-lime)]/5",
};

function nodeLabel(id: string) {
  return mapaNodes.find((n) => n.id === id)?.label ?? id;
}

function MapaSistemaPage() {
  return (
    <div>
      <SectionHeader
        breadcrumb="Arquitetura"
        title="Mapa visual do sistema"
        description="Camadas, entidades, relações e fluxos. Cada bloco leva à rota correspondente do ERP."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <StatusChip label="Módulo (tela)" tone="cyan" />
        <StatusChip label="Entidade / dado" tone="magenta" />
        <StatusChip label="Integração externa" tone="lime" />
      </div>

      {/* Camadas */}
      <div className="space-y-4">
        {camadas.map((camada, idx) => {
          const nodes = mapaNodes.filter((n) => n.camada === camada.id);
          if (nodes.length === 0) return null;
          return (
            <div key={camada.id}>
              <Card className="overflow-hidden">
                <div className="h-[2px]" style={{ background: "var(--gradient-cmyk)" }} />
                <CardContent className="p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                      Camada {String(idx + 1).padStart(2, "0")}
                    </span>
                    <StatusChip label={camada.label} tone={camada.tone} />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {nodes.map((n) =>
                      n.rota ? (
                        <Link
                          key={n.id}
                          to={n.rota}
                          className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors hover:brightness-125 ${tipoStyle[n.tipo]}`}
                        >
                          {n.label}
                          <div className="font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                            {n.rota}
                          </div>
                        </Link>
                      ) : (
                        <div
                          key={n.id}
                          className={`rounded-xl border px-4 py-3 text-sm font-semibold ${tipoStyle[n.tipo]}`}
                        >
                          {n.label}
                        </div>
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>
              {idx < camadas.length - 1 && (
                <div className="py-1 text-center text-muted-foreground">↓</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Relações */}
      <h2 className="mt-10 mb-3 text-lg font-black tracking-tight">Relações e fluxos de dados</h2>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  Origem
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  Destino
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  Mecanismo
                </th>
              </tr>
            </thead>
            <tbody>
              {mapaEdges.map((e) => (
                <tr key={`${e.from}-${e.to}`} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{nodeLabel(e.from)}</td>
                  <td className="px-4 py-2 font-medium text-[color:var(--bex-cyan)]">
                    → {nodeLabel(e.to)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{e.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Perfis × atividades */}
      <h2 className="mt-10 mb-3 text-lg font-black tracking-tight">Perfis, atividades e módulos</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {perfisAtividades.map((p) => (
          <Card key={p.perfil}>
            <CardContent className="p-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-base font-black tracking-tight capitalize">{p.perfil}</span>
                <Link
                  to="/matriz-permissoes"
                  className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  ver permissões
                </Link>
              </div>
              <ul className="mb-3 space-y-1 text-sm text-muted-foreground">
                {p.atividades.map((a) => (
                  <li key={a} className="flex gap-2">
                    <span className="text-[color:var(--bex-lime)]">•</span>
                    {a}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-1">
                {p.modulos.map((m) => (
                  <span
                    key={m}
                    className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
